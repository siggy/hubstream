// data flow:
// github/events -> github/users -> geocode -> publish to event queue

const GitHub   = require('github'),
      geocoder = require('geocoder'),
      Redis    = require('./redis');

const redis = Redis.createClient();

const USER_CACHE = 'user_cache';
const GEO_CACHE  = 'geo_cache';
const HASH_FIELD = 'json';
const HASH_TTL   = 86400*10;

const GITHUB_REQUEST_INTERVAL_MIN   = 720; // (3600 * 1000 / 5000)
const GITHUB_REQUEST_INTERVAL_MAX   = 5000;
const GITHUB_MIN_API_REMAINING      = 100;
const GITHUB_MIN_RATELIMIT_CHECK_MS = 5000;

var maxEventId = 0;

const stats = {
  events: 0,
  eventsUnique: 0,
  eventsDropped: 0,

  lastUserRequest: 0,
  eventsTimer: GITHUB_REQUEST_INTERVAL_MIN,
  githubTimer: GITHUB_MIN_RATELIMIT_CHECK_MS,

  githubRemaining: 0,
  githubReset: 0,
  githubLimitSkips: 0,
  githubOverLimit: 0,
  githubCacheHits: 0,
  githubCacheMisses: 0,

  geoLocations: 0,
  geoLimitSkips: 0,
  geoCacheHits: 0,
  geoCacheMisses: 0,

  geocodeErr: 0,
  geocodeOverLimit: 0,
  geocodeOk: 0,
  geocodeUnknown: 0,

  geoBackoff: 1000,
  geoNextTry: 0
};

var github = new GitHub({
  protocol: 'https',
  timeout: 5000,
  headers: {
    "user-agent": "hubstre.am"
  }
});

github.authenticate({
  type: 'oauth',
  key: process.env.HUBSTREAM_GITHUB_KEY,
  secret: process.env.HUBSTREAM_GITHUB_SECRET
});

function now() {
  return new Date().getTime();
}

function setRedis(hash, field, data, ttl) {
  var key = hash + ":" + field;
  redis.hset(key, HASH_FIELD, JSON.stringify(data));
  if (ttl > 0) {
    redis.expire(key, ttl);
  }
}

function getRedis(hash, field, ttl, callback) {
  var key = hash + ":" + field;
  redis.hget(key, HASH_FIELD, function (err, json) {
    if (err) {
      var errStr = 'redis.hget error ' + err + ' for ' + key;
      console.log(errStr);
      callback(errStr, null);
      return;
    }

    // update ttl
    if (ttl > 0) {
      redis.expire(key, ttl);
    }

    callback(0, JSON.parse(json));
  });
}

function geocode(userLocation, callback) {
  if (!userLocation) {
    callback('geocode: userLocation is null', null);
    return;
  }
  stats.geoLocations++;

  getRedis(GEO_CACHE, userLocation, 0, function (err, json) {
    if (json) {
      stats.geoCacheHits++;
      callback(0, json);

      return;
    } else if (err) {
      var errStr = 'getRedis error: ' + err + ' for ' + userLocation;
      console.log(errStr);
      callback(errStr, null);
      return;
    }

    stats.geoCacheMisses++;

    if (now() < stats.geoNextTry) {
      stats.geoLimitSkips++;
      callback('geocode: geoLimitSkip', null);
      return;
    }

    geocoder.geocode(userLocation, function (err, data) {
      if (err) {
        stats.geocodeErr += 1;

        var errStr = 'geocode.geocode error ' + err + ' for ' + userLocation;
        console.log(errStr);
        callback(errStr, null);
      } else if (data.status == 'OVER_QUERY_LIMIT') {
        stats.geocodeOverLimit += 1;

        var errStr = 'geocode: sleeping for ' + stats.geoBackoff / 1000 + ' seconds';
        stats.geoNextTry = now() + stats.geoBackoff;
        stats.geoBackoff *= 2;
        console.log(errStr);
        callback(errStr, null);
      } else if (data.status == 'OK') {
        stats.geocodeOk += 1;

        var geoData = data.results[0].geometry.location;
        setRedis(GEO_CACHE, userLocation, geoData, 0);
        stats.geoBackoff = 1000;
        stats.geoNextTry = 0;
        callback(0, geoData);
      } else {
        stats.geocodeUnknown += 1;

        var errStr = 'geocoder.gecode: unknown status ' + data.status + ' for ' + userLocation;
        console.log(errStr);
        callback(errStr, null);
      }
    });
  });
};

var trimmedUserFields = [
  'avatar_url',
  'id',
  'location',
  'login',
  'name'
];

function getUserFromGithub(login, callback) {
  github.users.getForUser({username: login}, function (err, user) {
    if (user && user.data) {
      // trim user down to what we need, save space in redis
      var trimmedUser = {};
      for (var i = 0; i < trimmedUserFields.length; i++) {
        trimmedUser[trimmedUserFields[i]] = user.data[trimmedUserFields[i]];
      }
      setRedis(USER_CACHE, user.data.id, trimmedUser, HASH_TTL);
      callback(0, trimmedUser);
    } else if (err) {
      var errStr = 'github.user.getForUser error: ' + err + ' for ' + login;
      console.log(errStr);
      callback(errStr, null);
    } else {
      var errStr = 'github.user.getForUser unknown state for ' + login;
      console.log(errStr);
      callback(errStr, null);
    }
  });
};

function getUser(actor, callback) {
  getRedis(USER_CACHE, actor.id, HASH_TTL, function (err, json) {
    if (json) {
      stats.githubCacheHits++;
      callback(0, json);
      return;
    } else if (err) {
      var errStr = 'getRedis error: ' + err + ' for ' + actor.id;;
      console.log(errStr);
      callback(errStr, null);
      return;
    }

    stats.githubCacheMisses++;

    // throttle event queries based on time / calls remaining
    var delay = 1.1 * stats.githubReset / stats.githubRemaining;
    if ((now() - stats.lastUserRequest) > delay) {
      getUserFromGithub(actor.login, callback);
      stats.lastUserRequest = now();
    } else {
      stats.eventsDropped++;
    }
  });
};

var eventMap = {
  'CommitCommentEvent': function(event) { return event['payload']['comment']['html_url']; },
  'CreateEvent': function(event) { return event['repo']['url'].replace("api.", "").replace('/repos', ''); },
  'DeleteEvent': function(event) { return event['repo']['url'].replace("api.", "").replace('/repos', ''); },
  'DeploymentEvent': function(event) { return event['payload']['foo']['bar']; },
  'DeploymentStatusEvent': function(event) { return event['payload']['foo']['bar']; },
  'DownloadEvent': function(event) { return event['payload']['foo']['bar']; },
  'FollowEvent': function(event) { return event['payload']['foo']['bar']; },
  'ForkEvent': function(event) { return event['payload']['forkee']['html_url']; },
  'ForkApplyEvent': function(event) { return event['payload']['foo']['bar']; },
  'GistEvent': function(event) { return event['payload']['foo']['bar']; },
  'GollumEvent': function(event) { return event['payload']['pages'][0]['html_url']; },
  'IssueCommentEvent': function(event) { return event['payload']['comment']['html_url']; },
  'IssuesEvent': function(event) { return event['payload']['issue']['html_url']; },
  'MemberEvent': function(event) { return event['repo']['url'] + '/collaborators'; },
  'PageBuildEvent': function(event) { return event['payload']['foo']['bar']; },
  'PublicEvent': function(event) { return event['repo']['url'].replace("api.", "").replace('/repos', ''); },
  'PullRequestEvent': function(event) { return event['payload']['pull_request']['html_url']; },
  'PullRequestReviewCommentEvent': function(event) { return event['payload']['comment']['html_url']; },
  'PushEvent': function(event) { return 'https://github.com/'+ event['repo']['name'] + '/commit/' + event['payload']['head']; },
  'ReleaseEvent': function(event) { return event['payload']['release']['html_url']; },
  'StatusEvent': function(event) { return event['payload']['foo']['bar']; },
  'TeamAddEvent': function(event) { return event['repo']['url']['bar']; },
  'WatchEvent': function(event) { return 'https://github.com/' + event['repo']['name'] + '/stargazers'; },
};

function dispatchEvent(event) {
  getUser(event.actor, function (err, user) {
    if (err) {
      console.log('getUser error: ' + err);
      return;
    }

    if (!user.location) {
      return;
    }

    geocode(user.location, function (err, geoData) {
      if (err) {
        console.log('geocode error: ' + err);
        return;
      }

      redis.publish(Redis.EVENT_QUEUE, JSON.stringify({
        event: event,
        user: user,
        geo: geoData,
        event_url: eventMap[event.type](event)
      }));
    });
  });
};

var checkGithubLimit = function () {
  console.log(stats);

  github.misc.getRateLimit({}, function(err, limits) {
    if (err) {
      console.log('github.misc.getRateLimit error: ' + err);
      stats.githubRemaining = 0;
    } else {
      if (limits.data.resources.core.remaining > GITHUB_MIN_API_REMAINING) {
        stats.githubRemaining = limits.data.resources.core.remaining - GITHUB_MIN_API_REMAINING;
      } else {
        console.log('github over limit: ' + JSON.stringify(limits));
        stats.githubRemaining = 0;
      }
      var reset = limits.data.resources.core.reset*1000 - now();
      if (reset > 0) {
        stats.githubReset = reset;
      } else {
        stats.githubReset = 0;
      }

      if (stats.githubRemaining == 0) {
        stats.githubOverLimit++;
        stats.githubTimer *= 2;
        console.log('github over limit: ' + stats.githubRemaining + ' remaining');
        console.log('github backoff increased to: ' + stats.githubTimer + 'ms');
      } else {
        stats.githubTimer = GITHUB_MIN_RATELIMIT_CHECK_MS;
      }
    }

    setTimeout(checkGithubLimit, stats.githubTimer);
  });
};
checkGithubLimit();

var getEvents = function () {
  if (!stats.githubRemaining) {
    stats.githubLimitSkips++;
    setTimeout(getEvents, stats.eventsTimer);
    return;
  }

  github.activity.getEvents({}, function (err, events) {
    if (err) {
      console.log('github.activity.getEvents error: ' + err);
      setTimeout(getEvents, stats.eventsTimer);
      return;
    }

    // filter out duplicate events
    var newEvents = events.data.filter(function (event) {
      return (parseInt(event.id) > maxEventId);
    }).sort(function (a,b) {
      return parseInt(a.id) - parseInt(b.id);
    });
    if (newEvents.length) {
      maxEventId = parseInt(newEvents[newEvents.length - 1].id);
    }

    // throttle events queries just enough to not miss any
    if (events.data.length == newEvents.length) {
      // we may have missed events, cut timer in half
      stats.eventsTimer = Math.max(Math.floor(stats.eventsTimer / 2), GITHUB_REQUEST_INTERVAL_MIN);
    } else if ((events.data.length / newEvents.length) > 1.2) {
      // more than 5 dupes (30 / 25), bump timer up a bit
      var dupes = events.data.length - newEvents.length;
      var increase = 1 + dupes / events.data.length;
      stats.eventsTimer = Math.min(Math.floor(stats.eventsTimer * increase), GITHUB_REQUEST_INTERVAL_MAX);
    }

    stats.events += events.data.length;
    stats.eventsUnique += newEvents.length;

    newEvents.forEach(function(event, i) {
      // for that more organic feel
      timeout = i ? Math.abs(Date.parse(event.created_at) - Date.parse(newEvents[0].created_at)) : 0;
      setTimeout(function () {
        dispatchEvent(event);
      }, timeout);
    });

    setTimeout(getEvents, stats.eventsTimer);
  });
};
getEvents();
