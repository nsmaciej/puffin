var Twit = require('twit');
var config = require('./config');
var bunyan = require('bunyan');
var request = require('request');
var util = require('util');
var fs = require('fs');
var express = require('express');
var waterstamp = require('waterstamp');
var mustache = require('mustache');


/* Esnures a property of an object is of a ceartain type (boolean or number) */
function ensureOrParse(object, property, type) {
    if (type == 'boolean') {
        if (typeof object[property] != 'boolean') {
            object[property] = (object[property] == 'true');
        }
    } else if (type == 'number') {
        if (typeof object[property] != 'number') {
            object[property] = parseInt(object[property]);
        }
    } else {
        throw new Error('Wrong type in ensureOrParse');
    }
}


/* Uses waterstamp to add a watermark to an image as specfied by 'image_template'.
 * In the future this function will re-generate text too */
function addWatermark(buffer) {
    return waterstamp(buffer, config.image_template);
}


/* Handle's an incomign tweet.
 * Since it contains no 'twit' calls it was separated from on('tweet') call for your enjoyment
 * 'cb' contains the true or false depenign on the successfully 'update_with_media' call
 * Doesn't log anything unless and error occurs */
function handleTweet(tweet, cb) {
    if (imageCache == null) { //We don't have an image to respond with
        log.warn('Missed tweet due to lack of global image cache!');
        cb(false);
        return;
    }

    // Prepare the respond text & data
    var statusText = config.response_template;
    // PHP-like templating system
    statusText = statusText.replace(/\$handle/g, tweet.user.screen_name);

    log.debug('Respond with "' + statusText + '"');

    // 'request' is magic - it knows to set 'multipart/form-data' automatically
    var options = {
        method: 'POST',
        url: 'https://api.twitter.com/1.1/statuses/update_with_media.json',
        oauth: {
            consumer_key: config.consumer_key,
            consumer_secret: config.consumer_secret,
            token: config.access_token,
            token_secret: config.access_token_secret
        }
    };

    var requestObject = request(options, function(error, response, body) {
        var headers = response.headers;

        if (twitterLimited) { // Nasty race condition
            return;
        }

        if (error) {
            log.error('Error occured during image upload "' + error + '"');
            cb(false);
            return;
        }

        if (response.statusCode == 403) {
            log.warn({reason: body}, 'Twitter update limit reached, waiting 5 minutes');
            twitterLimited = true;
            setTimeout(function (){
                log.warn('Twitter update limit lifted?');
                twitterLimited = false;
            }, 5 * 60 * 1000);
            return;

        } else if (response.statusCode != 200) {
            log.error('Twitter returned non-200 status code on image upload (' + response.statusCode + ')');
            cb(false);
            return;
        }

        // Rate limit message.. because webscale
        var msg = headers['x-mediaratelimit-remaining'] + ' of ' + headers['x-mediaratelimit-limit'];
        var unixTime = Math.round(new Date().getTime() / 1000); //Current UNIX timestamp in seconds
        msg += ' pieces of media remaining. Reset at ';
        msg += Math.round((parseInt(headers['x-mediaratelimit-reset']) - unixTime) / 60 / 60) + ' hours';
        log.info(msg);

        log.debug('Successfully responded to tweet');
        cb(true);
    });

    var form = requestObject.form();
    form.append('status', statusText);
    form.append('media[]', imageCache);

    if (config.set_reply_id) {
        form.append('in_reply_to_status_id', tweet.id);
    }
}


/* By default console.log stops at depth 2.
 * this calls inspect to ensure the whole object is dumped
 * (and in color ;) - only use for debugging */
function inspectLog(object) {
    console.log(util.inspect(object, {depth: null, colors: true}));
    startTwitterStream();
}


/* Updates the global image cache
 * bascily a binary buffer located at imageCache
 * it loops automatically every 'endpoint_recovery_time' after updating */
function startCacheUpdater() {
    if (requestingImage) {
        log.warn('Image request already in progress (consider modifying cache_duration)')
    }
    requestingImage = true;

    var startTime = process.hrtime();
    var url = 'http://' + config.endpoint_url + config.snapshot_url;
    var options = {
        url: url,
        timeout: config.endpoint_timeout,
        encoding: null // Don't encode, Arghh!
    };

    if (config.use_http_auth) { //For HTTP auth on servers
        options.auth = {
            username: config.http_username,
            password: config.http_password
        };
    }

    log.debug({url: url}, 'Requesing new image');
    request(options, function(error, response, body) {
        // Do this no matter what, since it can produce race conditions on errors
        requestingImage = false;
        // Loops back but without nasty Stack Overflows
        setTimeout(startCacheUpdater, config.endpoint_recovery_time);

        if (error) {
            return log.error({error: error}, 'Error requesing image');
        }
        if (response.statusCode != 200) {
            return log.error({statusCode: response.statusCode}, 'Non-200 status code during requsting an image');
        }

        endSconds = process.hrtime(startTime);
        imageCache = addWatermark(body);
        log.debug('Image cache updated (took ' + endSconds + 's)');
    })
}


/* Magic souce that makes twitter streams work
 * handles retrying and stream errors */
function startTwitterStream() {
    var twitter = new Twit({
        consumer_key: config.consumer_key,
        consumer_secret: config.consumer_secret,
        access_token: config.access_token,
        access_token_secret: config.access_token_secret
    });
    var stream = twitter.stream('statuses/filter', {track: config.track_keyword});

    // Show warnings (silent otherwise)
    stream.on('connected', function (res) {
        if (res.statusCode != 200) {
            log.error('Non-200 status code on Twitter connection (' + res.statusCode + ')');
            return;
        }
        log.info('Twitter connection successful');
    });

    // Multiple streams or what-have-you (silent otherwise)
    stream.on('disconnect', function(msg) {
        log.warn('Twitter dosconnected. Reason "' + msg + '"');
    });

    stream.on('tweet', function(tweet) {
        if (config.do_not_respond || twitterLimited) { //Silently fail
            return;
        }

        log.debug('Responding to tweet "' + tweet.text + '"');

        // Damn callback require this to be in a separate function
        var tryResponse = function() {
            handleTweet(tweet, function(ok) {
                if (!ok && config.retry_on_failure) { //We failed and we want to rety
                    log.warn('\'retry_on_failure\' on. Retrying');
                    process.setImmediate(tryResponse);
                }
            });
        };
        tryResponse();
    });
}


/* Starts a server for easily chaning the configuration */
function startHttpConfigServer() {
    var app = express();

    app.use(express.basicAuth(config.http_config_username, config.http_config_password));
    app.use(express.urlencoded());
    app.use(app.router);
    app.use(express.static('public'));

    app.get('/', function(req, res) {
        log.warn('Settings page acessed');
        res.end(mustache.render(fs.readFileSync('public/index.html', 'utf-8'), httpConfig));
    });

    app.get('/preview.png', function(req, res) {
        res.setHeader('Content-type', 'image/png');
        res.end(imageCache);
    });

    app.post('/', function(req, res) {
        log.warn('New settings saved');

        // Show what settings were chnaged
        var changed = {};
        for (var key in req.body) {
            if (httpConfig[key] != req.body[key]) {
                changed[key] = req.body[key];
            }
        }
        log.info(changed, 'Changed settings are');

        httpConfig = req.body; // Save changes
        ensureOrParse(httpConfig, 'set_reply_id', 'boolean');
        ensureOrParse(httpConfig, 'use_http_auth', 'boolean');
        ensureOrParse(httpConfig, 'endpoint_timeout', 'number');
        ensureOrParse(httpConfig, 'endpoint_recovery_time', 'number');
        fs.writeFileSync(config.http_config_file, JSON.stringify(httpConfig, null, 4)); //Format nicely

        res.sendfile('public/wait.html');
        setTimeout(function() {
            process.exit(0);
        }, 1000 * 5);
    });

    log.info('Starting configuration server at port ' + config.config_port);
    app.listen(config.config_port);
}


/* Main body */
var log = bunyan.createLogger({
    name: config.bunyan_name,
    streams: config.bunyan_streams
});
var imageCache = null;
var requestingImage = false;
var twitterLimited = false;
var httpConfig = JSON.parse(fs.readFileSync(config.http_config_file));
for (var key in httpConfig) { // Merge settings
    config[key] = httpConfig[key];
}

startCacheUpdater();

if (config.start_twitter_stream) {
    log.info('Tracking "' + config.track_keyword + '"');
    if (!config.set_reply_id) {
        log.warn('set_reply_id is off. Tweets won\'t be responses');
    }
    if (config.do_not_respond) {
        log.warn('do_not_respond is on. Won\'t send responses');
    }
    startTwitterStream();
} else {
    log.warn('start_twitter_stream if off. Won\'t listen for twitter events');
}

if (config.start_http_config) {
    startHttpConfigServer();
} else {
    log.warn('start_http_config is off. Won\'t start http configuration server');
}
