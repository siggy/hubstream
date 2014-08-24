var map;
var markers    = [];
var lastMarker;
var infowindow = new google.maps.InfoWindow();
var autoplay   = true;

function initialize() {
  map = new google.maps.Map(document.getElementById('map-canvas'), {
    center: new google.maps.LatLng(30, 0),
    zoom: 2,
    disableDefaultUI: true,
    mapTypeControl: true
  });

  // disable autoplay on map click
  // this only works because marker click events don't appear to propagate correctly
  google.maps.event.addListener(map, 'click', function() {
    autoplay = false;
  });

  var autoPlayFn = function() {
    if (markers.length) {
      if (markers[markers.length-1] !== lastMarker) {
        lastMarker = markers[markers.length-1];
        google.maps.event.trigger(lastMarker, 'click');
      }
    }

    if (autoplay) {
      setTimeout(autoPlayFn, 1500);
    }
  }
  autoPlayFn();

  var host = location.origin.replace(/^http/, 'ws');
  var ws = new WebSocket(host);
  ws.onmessage = function (message) {
    processEvent(JSON.parse(message.data));
  };
}
google.maps.event.addDomListener(window, 'load', initialize);

function processEvent(data) {
  var marker = new google.maps.Marker({
    map: map,
    animation: google.maps.Animation.DROP,
    position: new google.maps.LatLng(data.geo.lat, data.geo.lng),
    icon: image = {
      url: data.user.avatar_url,
      size: new google.maps.Size(24, 24),
      origin: new google.maps.Point(0, 0),
      anchor: new google.maps.Point(0, 0),
      scaledSize: new google.maps.Size(24, 24)
    }
  });

  markers.push(marker);
  if (markers.length > 200) {
    markers.shift().setMap(null);
  }

  google.maps.event.addListener(marker, 'click', function() {
    infowindow.setContent(
      '<div class="infowindow">' +
        '<a target="_blank" href="' + data.user.html_url + '">' +
          '<img src="' + data.user.avatar_url + '" class="avatar" alt="' + data.user.login + '" title="' + data.user.login + '">' +
        '</a>' +
        '<div class="data">' +
          '<ul>' +
            '<li class="fullname">' + data.user.name + '</li>' +
            '<li>' +
              data.user.location +
            '</li>' +
          '</ul>' +
          '<ul class="github">' +
            '<li>&nbsp;</li>' +
            '<li>&nbsp;</li>' +
            '<li>' +
              '<a target="_blank" href="' + data.user.html_url + '">' +
                '<img src="https://github.com/favicon.ico" class="favicon"></img>' +
              '</a>' +
            '</li>' +
            '<li>' +
              '<a target="_blank" href="' + data.user.html_url + '">' + data.user.login +'</a>' +
            '</li>' +
            '<li><a target="_blank" href="https://github.com/' + data.event.repo.name + '">' + data.event.repo.name + '</a></li>' +
            '<li><a target="_blank" href="' + data.event_url + '">' + data.event.type + '</a></li>' +
          '</ul>' +
        '</div>' +
      '</div>'
    );

    infowindow.open(map, marker);
  });
}
