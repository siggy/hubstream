Hubstream
===========

Streaming Github events on a Google Map

Local

    npm install
    foreman start

Deploy

    heroku create
    heroku addons:add redistogo
    heroku addons:upgrade redistogo:mini
    git push heroku master
    heroku open
