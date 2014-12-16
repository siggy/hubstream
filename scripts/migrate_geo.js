var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

var redis = Redis.createClient();

var USER_CACHE = 'user_cache';
var GEO_CACHE  = 'geo_cache';
var HASH_FIELD = 'json';
var HASH_TTL   = 86400;

var count = 0;
var migrate = function(cursor) {
  redis.hscan(GEO_CACHE, cursor, function(err, json) {

    function migrateKey(json, index) {
      if (index == json[1].length / 2) {
        return;
      }

      var userLocation = json[1][index*2];
      var data         = json[1][index*2+1];

      count += 1;

      var key = GEO_CACHE + ":" + userLocation;
      redis.hset(key, HASH_FIELD, data);
      redis.expire(key, HASH_TTL);
      redis.hdel(GEO_CACHE, userLocation, function(err, reply) {
        if (reply != 1) {
          console.log("hdel returned " + reply + " for userLocation: " + userLocation);
        }
        redis.hlen(GEO_CACHE, function(err, hlen) {
          console.log('migrated: ' + count + " remaining: " + hlen + ": " + userLocation);
          migrateKey(json, index+1);
        });
      });
    }

    migrateKey(json, 0);

    if (json[0] != '0') {
      migrate(json[0]);
    }
  });
}
migrate('0');
