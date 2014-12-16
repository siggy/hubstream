var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

var redis = Redis.createClient();

var USER_CACHE = 'user_cache';
var USER_FIELD = 'json';
var USER_TTL   = 86400;
var GEO_CACHE    = 'geo_cache';
redis.hget(GEO_CACHE, "Thousand Oaks Ca", function (err, json) {
  console.log(json);
});

redis.hlen(USER_CACHE, function(err, json) {console.log(json)});
redis.hlen(GEO_CACHE, function(err, json) {console.log(json)});

redis.hscan(GEO_CACHE, 0, function(err, json) {console.log(json)});

redis.hscan(USER_CACHE, 0, function(err, json) {console.log(json)});

redis.expire(USER_CACHE, 10, function(err, json) {console.log(json)});

redis.ttl(USER_CACHE, function(err, json) {console.log(json)});

redis.keys("user*", function(err, json) {console.log(json)});

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
      redis.hset(key, USER_FIELD, data);
      redis.expire(key, USER_TTL);
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
