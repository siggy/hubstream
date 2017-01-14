var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

// github
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
github.misc.rateLimit({}, function(err, limits) {console.log(limits)});

// redis
var redis = Redis.createClient();

var USER_CACHE = 'user_cache';
var GEO_CACHE  = 'geo_cache';
var HASH_FIELD = 'json';
var HASH_TTL   = 86400;

redis.keys(USER_CACHE+":*", function(err, json) {console.log(json.length)});
redis.keys(GEO_CACHE+":*", function(err, json) {console.log(json.length)});

redis.hget(GEO_CACHE+":Thousand Oaks Ca", HASH_FIELD, function (err, json) {
  console.log(json);
});

redis.info(function(err, j) { console.log(j) });

var total = 0;
var migrate = function(cursor) {
  redis.hscan(USER_CACHE, cursor, function(err, json) {
    for (var i = 0; i < json[1].length / 2; i++) {
      userId = json[1][i*2];
      data   = json[1][i*2+1];

      console.log(userId);
      console.log(data);

      total += 1;
      console.log("total: " + total);

      var key = USER_CACHE + ":" + userId;
      redis.hset(key, HASH_FIELD, data);
      redis.expire(key, HASH_TTL);
      redis.hdel(USER_CACHE, userId, function(err, reply) {
        if (reply != 1) {
          console.log("hdel returned " + reply + " for userId: " + userId);
        }
      });
    }

    if (json[0] != '0') {
      migrate(json[0]);
    }
  });
}
migrate('0');

redis.info(function(err, j) { console.log(j) });
