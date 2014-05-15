var Twit = require('twit');
var config = require('./config');
var bunyan = require('bunyan');
var request = require('request');
var util = require('util');
var fs = require('fs');
var http = require('http');
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
function handleTweet(tweet) {
    if (config.do_not_respond) { //Silently fail
        return;
    }

    var statusText = config.response_template;
    statusText = statusText.replace(/\$handle/g, tweet.user.screen_name); //PHP-like templating system

    log.debug('Responding to tweet "' + tweet.text + '"');
    log.debug('Respond with "' + statusText + '"');
    statsData.tweets_recived += 1;

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

    // Request new or cached image
    requestImage(function (image) {
        var requestObject = request(options, function(error, response, body) {
            var headers = response.headers;

            if (error) {
                statsData.failed_responses += 1;
                log.error('Error occured during image upload "' + error + '"');
                return;
            }

            if (response.statusCode != 200) {
                statsData.failed_responses += 1;
                log.error(body, 'Twitter returned non-200 status code on image upload (' + response.statusCode + ')');
                return;
            }

            // Rate limit message.. because webscale
            var msg = headers['x-mediaratelimit-remaining'] + ' of ' + headers['x-mediaratelimit-limit'];
            var unixTime = Math.round(new Date().getTime() / 1000); //Current UNIX timestamp in seconds
            msg += ' pieces of media remaining. Reset at ';
            msg += Math.round((parseInt(headers['x-mediaratelimit-reset']) - unixTime) / 60 / 60) + ' hours';
            log.info(msg);

            statsData.successful_responses += 1;
            log.debug('Successfully responded to tweet');
        });

        var form = requestObject.form();
        form.append('status', statusText);
        if (config.set_reply_id) {
            log.debug('Setting \'in_reply_to_status_id\' to ' + tweet.id_str);
            form.append('in_reply_to_status_id', tweet.id_str);
        }
        form.append('media[]', imageCache);
    });
}


/* By default console.log stops at depth 2.
 * this calls inspect to ensure the whole object is dumped
 * (and in color ;) - only use for debugging */
function inspectLog(object) {
    console.log(util.inspect(object, {depth: null, colors: true}));
    startTwitterStream();
}


/* Check is cache still valid */
function cacheValidCheck() {
    if (imageCache == null) { //No cache
        return false;
    }
    if (!config.cache_invalidation) { //Cache is always valid
        return true;
    }
    if (process.hrtime(imageCacheTimeout)[0] <= (config.cache_duration / 1000)) { //Still valid timing
        return true;
    }
    return false; //Fallback
}


/* Request the image, fires a new camera request unless cached with 'cache_duration' */
function requestImage(cb) {
    // Try to return the cache if it's still valid
    // The hrtime() returns time in [secs, nanosecs]
    if (!forceNewCache && cacheValidCheck()) {
        log.debug('Retruning a cached image');
        cb(imageCache);
        return;
    }

    if (requestingImage) {
        log.warn('Image request already in progress, returning old image');
        cb(imageCache);
        return;
    }

    forceNewCache = false;
    requestingImage = true;

    var startTime = process.hrtime();
    var url = 'http://' + config.endpoint_url + config.snapshot_url;
    var options = {
        url: url,
        timeout: config.endpoint_timeout,
        encoding: null // Don't encode, Arghh!
    };

    if (config.use_http_auth) { // For HTTP auth on servers
        options.auth = {
            username: config.http_username,
            password: config.http_password
        };
    }

    log.warn({url: url}, 'Missing or old cache, requesting new image');
    request(options, function(error, response, body) {
        // Do this no matter what, since it can produce race conditions on errors
        requestingImage = false;
        statsData.last_image_status = response.statusCode;

        if (error) {
            return log.error({error: error}, 'Error requesing image');
        }
        if (response.statusCode != 200) {
            return log.error({statusCode: response.statusCode}, 'Non-200 status code during requsting an image');
        }

        endSconds = process.hrtime(startTime)[0];
        statsData.last_image_time = endSconds;
        imageCache = addWatermark(body);
        log.debug('Image cache updated (took ' + endSconds + 's)');
        imageCacheTimeout = process.hrtime(); // Update cache validation
        cb(imageCache); // Give back our image
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

    stream.on('tweet', handleTweet);
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

    app.get('/stats.html', function(req, res) {
        statsData.last_image_status_text = http.STATUS_CODES[statsData.last_image_status] || 'Unknown';
        statsData.cache_valid = cacheValidCheck();
        res.end(mustache.render(fs.readFileSync('public/stats.html', 'utf-8'), statsData));
    });

    app.get('/invalidate.html', function(req, res) {
        forceNewCache = true;
        log.warn('Cache invalidation requested manually');
        requestImage(function() {
            log.info('Manual cache invalidation successful');
        });
        res.sendfile('public/invalidate.html');
    });

    app.get('/preview.png', function(req, res) {
        log.info('New image preview request');
        res.setHeader('Content-type', 'image/png');
        requestImage(function(image) {
            res.end(image);
        });
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
        ensureOrParse(httpConfig, 'cache_invalidation', 'boolean');
        ensureOrParse(httpConfig, 'endpoint_timeout', 'number');
        ensureOrParse(httpConfig, 'cache_duration', 'number');
        fs.writeFileSync(config.http_config_file, JSON.stringify(httpConfig, null, 4)); //Format nicely

        res.sendfile('public/wait.html');
        setTimeout(function() {
            process.exit(0);
        }, 1000 * 5);
    });

    log.info('Starting configuration server at port ' + config.config_port);
    app.listen(config.config_port, '0.0.0.0');
}


/* Main body */
var log = bunyan.createLogger({
    name: config.bunyan_name,
    streams: config.bunyan_streams
});
var imageCache = null;
var imageCacheTimeout = process.hrtime();
var requestingImage = false;
var forceNewCache = false;
var statsData = {
    tweets_recived: 0,
    successful_responses: 0,
    failed_responses: 0,
    last_image_time: -1,
    last_image_status: -1,
    cache_valid: true,
};

var httpConfig = JSON.parse(fs.readFileSync(config.http_config_file));
for (var key in httpConfig) { // Merge settings
    config[key] = httpConfig[key];
}

if (!config.cache_invalidation) {
    log.warn('\'cache_invalidation\' is off. Cache will last forever');
    requestImage(function() {
        log.info('Initial image cache updated');
    });
}
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
