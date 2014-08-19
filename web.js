var redis = require('redis').createClient();
redis.on('error', function (err) {
  console.log('Error ' + err);
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