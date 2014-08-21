var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

redis = Redis.createClient();

var USER_CACHE   = 'user_cache';
var GEO_CACHE    = 'geo_cache';

var GITHUB_MIN = 4700;
var githubRemaining = 0;

var maxEventId = 0;

var stats = {
  events: 0,
  dupEvents: 0,
  locations: 0,

  githubLimitSkips: 0,
  githubOverLimit: 0,
  userCacheHits: 0,
  userCacheMisses: 0,

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
}

function getUser(actor, callback) {
  redis.hget(USER_CACHE, actor.id, function (err, json) {
    if (json) {
      stats.userCacheHits++;
      return callback(0, JSON.parse(json));
    } else if (err) {
      console.log('redis.hget error: ' + err);
    }

    stats.userCacheMisses++;

    github.user.getFrom({user: actor.login}, function (err, user) {
      if (user) {
        redis.hset(USER_CACHE, user.id, JSON.stringify(user));
        callback(0, user);
      } else if (err) {
        console.log('github.user.getFrom error: ' + err);
      }
    });
  });
}

var githubBackoff = 1000;
var checkGithubLimit = function () {
  github.misc.rateLimit({}, function(err, limits) {
    if (err) {
      console.log('github.misc.rateLimit error: ' + err);
      githubRemaining = 0;
      return;
    }

    githubRemaining = limits.resources.core.remaining;
    console.log('github api calls remaining: ' + githubRemaining);

    if (githubRemaining < GITHUB_MIN) {
      stats.githubOverLimit++;
      githubBackoff *= 2;
      console.log('github over limit: ' + githubRemaining + ' remaining');
      console.log('github backoff increased to: ' + githubBackoff + 'ms');
    } else {
      githubBackoff = 1000;
    }

    setTimeout(checkGithubLimit, githubBackoff);
  });
}
setTimeout(checkGithubLimit, githubBackoff);

setInterval(function() {
  if (githubRemaining < GITHUB_MIN) {
    stats.githubLimitSkips++;
    return;
  }

  github.events.get({}, function (err, events) {
    if (err) {
      console.log('github.events.get error: ' + err);
      return;
    }

    sortedEvents = events.sort(function (a,b) {
      return parseInt(a.id) - parseInt(b.id);
    });

    sortedEvents.forEach(function(event) {
      if (maxEventId > parseInt(event.id)) {
        stats.dupEvents++;
        return;
      }
      maxEventId = parseInt(event.id);

      stats.events++;
      if (stats.events % 10 == 0) {
        console.log(stats);
      }

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
  });
}, 1000);
