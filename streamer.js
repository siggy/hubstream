var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

redis = Redis.createClient();

var USER_CACHE   = 'user_cache';
var GEO_CACHE    = 'geo_cache';

var GITHUB_MIN_REMAINING = 2000;
var GITHUB_MAX_EVENT_DELAY_MS = 10000;

var maxEventId = 0;

var stats = {
  events: 0,
  uniqueEvents: 0,
  locations: 0,

  githubLimitSkips: 0,
  githubOverLimit: 0,
  userCacheHits: 0,
  userCacheMisses: 0,
  eventsDropped: 0,

  geoLimitSkips: 0,
  geoOverLimit: 0,
  geoCacheHits: 0,
  geoCacheMisses: 0,

  eventTimer: 1000,
  eventsTimer: 1000,

  githubRemaining: 0,
  githubReset: 0
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
  stats.locations++;
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
      stats.userCacheHits++;
      return callback(0, JSON.parse(json));
    } else if (err) {
      console.log('redis.hget error: ' + err);
    }

    stats.userCacheMisses++;

    // throttle event queries based on time / calls remaining
    stats.eventTimer = Math.ceil(stats.githubReset / stats.githubRemaining)*2;
    if (stats.eventTimer < GITHUB_MAX_EVENT_DELAY_MS) {
      setTimeout(function() { getUserFromGithub(actor.login, callback); }, stats.eventTimer);
    } else {
      stats.eventsDropped++;
    }
  });
};

var githubTimer = 1000;
var checkGithubLimit = function () {
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
        githubTimer *= 2;
        console.log('github over limit: ' + stats.githubRemaining + ' remaining');
        console.log('github backoff increased to: ' + githubTimer + 'ms');
      } else {
        githubTimer = 1000;
      }
    }

    setTimeout(checkGithubLimit, githubTimer);
  });
};
setTimeout(checkGithubLimit, githubTimer);

var getEvents = function () {
  if (!stats.githubRemaining) {
    stats.githubLimitSkips++;
    setTimeout(getEvents, stats.eventsTimer);
    return;
  }

  github.events.get({}, function (err, events) {
    if (err) {
      console.log('github.events.get error: ' + err);
    } else {
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
      } else if ((events.length / newEvents.length) > 1.5) {
        // 33% duplicate events, bump timer up a bit
        stats.eventsTimer = Math.floor(stats.eventsTimer * 1.1);
      }

      stats.events += events.length;
      stats.uniqueEvents += newEvents.length;
      console.log(stats);

      newEvents.forEach(function(event) {
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
              geo: geoData.results[0].geometry.location
            }));
          });
        });
      });
    }
    setTimeout(getEvents, stats.eventsTimer);
  });
};
setTimeout(getEvents, stats.eventsTimer);
