var redisHost = '127.0.0.1';
var redisPort = 6379;
var redisPass = '';
console.log("yo1");
if (process.env.REDISTOGO_URL) {
  // redis://username:password@host:port/
  var rtg   = require("url").parse(process.env.REDISTOGO_URL);
console.log("yo2");
console.log(rtg);
  redisHost = rtg.hostname;
  redisPort = rtg.port;
  redisPass = rtg.auth.split(":")[1];
console.log(redisHost);
}
console.log("yo3");

var redis = require("redis").createClient(redisPort, redisHost);
redis.auth(redisPass);

redis.on('error', function (err) {
  console.log('web.js Redis Error: ' + err);
});

var clients = [];

var EVENT_QUEUE  = 'event_queue';
redis.on("message", function (channel, message) {
  clients.forEach(function(client) {
    client.send(message, function() {});
  });
});
redis.subscribe(EVENT_QUEUE);

var WebSocketServer = require("ws").Server;
var http = require("http");
var express = require("express");
var app = express();
var port = process.env.PORT || 5000;

app.use(express.static(__dirname + "/"));

var server = http.createServer(app);
server.listen(port);

console.log("http server listening on %d", port);

var wss = new WebSocketServer({server: server});
console.log("websocket server created");

wss.on("connection", function(ws) {
  console.log("websocket connection open");
  clients.push(ws);

  ws.on("close", function() {
    console.log("websocket connection close");
    clients.splice(clients.indexOf(ws), 1);
  });
});