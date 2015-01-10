var GitHub      = require('github'),
    geocoder    = require('geocoder'),
    Redis       = require('./redis');

var redis = Redis.createClient();

var USER_CACHE = 'user_cache';
var GEO_CACHE  = 'geo_cache';
var HASH_FIELD = 'json';
var HASH_TTL   = 86400;

var stats = {
  geo: 0,
  user: 0,
  undef: 0
}

var count = 0;
var scanKeys = function(cursor) {
  redis.scan(cursor, function(err, keys) {

    function getKey(keys, index) {
      if (index == keys[1].length) {
        return;
      }

      var key = keys[1][index];
      if (key.indexOf(GEO_CACHE) !== -1) {
        redis.hget(key, HASH_FIELD, function(err, data) {
          stats.geo += 1;

          if (data === undefined) {
            stats.undef += 1;
            getKey(keys, index+1);
            return;
          }
          var json = JSON.parse(data);
          console.log(json);
          getKey(keys, index+1);
        });
      } else if (key.indexOf(USER_CACHE) !== -1) {
        stats.user += 1;
        getKey(keys, index+1);
      }
    }

    getKey(keys, 0);

    if (keys[0] != '0') {
      // console.log(keys);
      console.log(stats);
      scanKeys(keys[0]);
    }
  });
}
scanKeys('0');
