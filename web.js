const Redis   = require('./redis');
const redis   = Redis.createClient();
const clients = [];

redis.on('message', function (channel, message) {
  clients.forEach(function(client) {
    client.send(message, function() {});
  });
});
redis.subscribe(Redis.EVENT_QUEUE);

const port = process.env.PORT || 5000;
const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');
const app = express();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
server.listen(port, function listening() {
  console.log('Listening on %d', server.address().port);
});

app.use(express.static(__dirname + '/'));

console.log('websocket server created');

wss.on('connection', function connection(ws) {
  clients.push(ws);
  console.log('websocket connection open: ' + clients.length + ' clients connected');

  ws.on('close', function incoming() {
    clients.splice(clients.indexOf(ws), 1);
    console.log('websocket connection close: ' + clients.length + ' clients connected');
  });
});
