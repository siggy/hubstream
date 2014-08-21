var Redis   = require('./redis');
var redis   = Redis.createClient();
var clients = [];

redis.on('message', function (channel, message) {
  clients.forEach(function(client) {
    client.send(message, function() {});
  });
});
redis.subscribe(Redis.EVENT_QUEUE);

var WebSocketServer = require('ws').Server;
var http = require('http');
var express = require('express');
var app = express();
var port = process.env.PORT || 5000;

app.use(express.static(__dirname + '/'));

var server = http.createServer(app);
server.listen(port);

console.log('http server listening on %d', port);

var wss = new WebSocketServer({server: server});
console.log('websocket server created');

wss.on('connection', function(ws) {
  clients.push(ws);
  console.log('websocket connection open: ' + clients.length + ' clients connected');

  ws.on('close', function() {
    clients.splice(clients.indexOf(ws), 1);
    console.log('websocket connection close: ' + clients.length + ' clients connected');
  });
});