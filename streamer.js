var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

var redis = Redis.createClient();

var USER_CACHE   = 'user_cache';
var GEO_CACHE    = 'geo_cache';

var GITHUB_MIN_REMAINING = 1000;
var GITHUB_MAX_EVENT_DELAY_MS = 5000;

var maxEventId = 0;

var stats = {
  events: 0,
  eventsUnique: 0,
  eventsDropped: 0,

  eventTimer: 1000,
  eventsTimer: 1000,
  githubTimer: 1000,

  githubRemaining: 0,
  githubReset: 0,
  githubLimitSkips: 0,
  githubOverLimit: 0,
  githubCacheHits: 0,
  githubCacheMisses: 0,

  geoLocations: 0,
  geoLimitSkips: 0,
  geoOverLimit: 0,
  geoCacheHits: 0,
  geoCacheMisses: 0
};

var github = new GitHub({
  version: '3.0.0',
  protocol: 'https',
  timeout: 5000
});

github.authenticate({
  type: 'oauth',
  key: process.env.HUBSTREAM_GITHUB_KEY,
  secret: process.env.HUBSTREAM_GITHUB_SECRET
});

var geoBackoff = 1000;
var geoNextTry = 0;
function geocode(userLocation, callback) {
  if (!userLocation) {
    return;
  }
  stats.geoLocations++;
  redis.hget(GEO_CACHE, userLocation, function (err, json) {
    if (json) {
      stats.geoCacheHits++;
      return callback(0, JSON.parse(json));
    }

    stats.geoCacheMisses++;

    if (new Date().getTime() < geoNextTry) {
      stats.geoLimitSkips++;
      return;
    }

    geocoder.geocode(userLocation, function (err, data) {
      if (err) {
        console.log('geocode.geocode error: ' + err);
        return;
      }

      if (data.status == 'OVER_QUERY_LIMIT') {
        stats.geoOverLimit++;
        console.log('geocode: sleeping for ' + geoBackoff / 1000 + ' seconds');
        geoNextTry = new Date().getTime() + geoBackoff;
        geoBackoff *= 2;
      } else if (data.status == 'OK') {
        redis.hset(GEO_CACHE, userLocation, JSON.stringify(data));
        geoBackoff = 1000;
        geoNextTry = 0;
        callback(0, data);
      }
    });

  });
};

function getUserFromGithub(login, callback) {
  github.user.getFrom({user: login}, function (err, user) {
    if (user) {
      redis.hset(USER_CACHE, user.id, JSON.stringify(user));
      callback(0, user);
    } else if (err) {
      console.log('github.user.getFrom error: ' + err);
    }
  });
};

function getUser(actor, callback) {
  redis.hget(USER_CACHE, actor.id, function (err, json) {
    if (json) {
      stats.githubCacheHits++;
      return callback(0, JSON.parse(json));
    } else if (err) {
      console.log('redis.hget error: ' + err);
    }

    stats.githubCacheMisses++;

    // throttle event queries based on time / calls remaining
    stats.eventTimer = Math.ceil(stats.githubReset / stats.githubRemaining)*2;
    if (stats.eventTimer < GITHUB_MAX_EVENT_DELAY_MS) {
      setTimeout(function() { getUserFromGithub(actor.login, callback); }, stats.eventTimer);
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
  'WatchEvent': function(event) { return 'https://github.com/' + event['repo']['name'] + '/watchers'; },
};

function dispatchEvent(event) {
  getUser(event.actor, function (err, user) {
    if (err) {
      console.log('getUser error: ' + err);
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
        geo: geoData.results[0].geometry.location,
        event_url: eventMap[event.type](event)
      }));
    });
  });
};

var checkGithubLimit = function () {
  console.log(stats);

  github.misc.rateLimit({}, function(err, limits) {
    if (err) {
      console.log('github.misc.rateLimit error: ' + err);
      stats.githubRemaining = 0;
    } else {
      if (limits.resources.core.remaining > GITHUB_MIN_REMAINING) {
        stats.githubRemaining = limits.resources.core.remaining - GITHUB_MIN_REMAINING
      } else {
        stats.githubRemaining = 0;
      }
      stats.githubReset = limits.resources.core.reset*1000 - (new Date().getTime());

      if (stats.githubRemaining == 0) {
        stats.githubOverLimit++;
        stats.githubTimer *= 2;
        console.log('github over limit: ' + stats.githubRemaining + ' remaining');
        console.log('github backoff increased to: ' + stats.githubTimer + 'ms');
      } else {
        stats.githubTimer = 1000;
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

  github.events.get({}, function (err, events) {
    if (err) {
      console.log('github.events.get error: ' + err);
      return;
    }

    // filter out duplicate events
    var newEvents = events.filter(function (event) {
      return (parseInt(event.id) > maxEventId);
    }).sort(function (a,b) {
      return parseInt(a.id) - parseInt(b.id);
    });
    if (newEvents.length) {
      maxEventId = parseInt(newEvents[newEvents.length - 1].id);
    }

    // throttle events queries just enough to not miss any
    if (events.length == newEvents.length) {
      // we may have missed events, cut timer in half
      stats.eventsTimer = Math.floor(stats.eventsTimer / 2);
    } else if ((events.length / newEvents.length) > 1.2) {
      // 5 duplicates out of 30 events, bump timer up a bit
      stats.eventsTimer = Math.min(Math.floor(stats.eventsTimer * 1.1), GITHUB_MAX_EVENT_DELAY_MS);
    }

    stats.events += events.length;
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