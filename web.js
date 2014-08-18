// web.js
var Redis   = require('redis'),
    express = require("express"),
    logfmt  = require("logfmt");

var EVENT_QUEUE  = 'event_queue';

var redisClient = Redis.createClient();
redisClient.on('error', function (err) {
  console.log('Error ' + err);
});

redisClient.on("message", function (channel, message) {
  console.log("redisClient message " + channel + ": " + message);

  event = JSON.parse(message);
  console.log(event);
});

redisClient.subscribe(EVENT_QUEUE);


// dump all users
// redisClient.hgetall(USER_CACHE, function (err, obj) {
//   Object.keys(obj).forEach(function(id) {
//     console.log(id);
//     console.log(obj[id]);
//   });
// });

// dump all geos
// redisClient.hgetall(GEO_CACHE, function (err, obj) {
//   Object.keys(obj).forEach(function(id) {
//     console.log(id);
//     console.log(obj[id]);
//   });
// });


var app = express();

app.use(logfmt.requestLogger());

app.get('/', function(req, res) {
  res.send('Hello World!');
});

var port = Number(process.env.PORT || 5000);
app.listen(port, function() {
  console.log("Listening on " + port);
});
