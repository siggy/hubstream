var redisHost = '127.0.0.1';
var redisPort = 6379;
var redisPass = '';

if (process.env.REDISTOGO_URL) {
  // redis://username:password@host:port/
  var rtg   = require('url').parse(process.env.REDISTOGO_URL);
  redisHost = rtg.hostname;
  redisPort = rtg.port;
  redisPass = rtg.auth.split(':')[1];
}

exports.EVENT_QUEUE = 'event_queue';

exports.createClient = function () {
  console.log('creating redis client for ' + module.parent.filename);
  var redis = require('redis').createClient(redisPort, redisHost);
  redis.auth(redisPass);

  redis.on('error', function (err) {
    console.log(module.parent.filename + ' Redis Error: ' + err);
  });

  return redis;
}
