Hubstream
===========

Streaming Github events on a Google Map

Local

    npm install
    foreman start

Deploy

    heroku create
    heroku addons:add redistogo
    git push heroku master
    heroku open

Deploy branch
    git push heroku branch:master