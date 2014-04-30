var Twit = require('twit');
var config = require('./config');
var bunyan = require('bunyan');
var request = require('request');
var util = require('util');
var fs = require('fs');
var http = require('http');


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

        // Rate limit message.. because webscale
        var msg = headers['x-mediaratelimit-remaining'] + ' of ' + headers['x-mediaratelimit-limit'];
        var unixTime = Math.round(new Date().getTime() / 1000); //Current UNIX timestamp in seconds
        msg += ' pieces of media remaining. Reset at ';
        msg += Math.round((parseInt(headers['x-mediaratelimit-reset']) - unixTime) / 60 / 60) + ' hours';
        log.info(msg);

        if (error) {
            log.error('Error occured during image upload "' + error + '"');
            cb(false);
            return;
        }
        if (response.statusCode != 200) {
            log.error('Twitter returned non-200 status code on image upload (' + response.statusCode + ')');
            cb(false);
            return;
        }

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
        imageCache = body;
        log.debug('Image cache updated (took ' + endSconds + 's)');
    });
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
        if (config.do_not_respond) { //Silently fail
            return;
        }

        log.info('Responding to tweet "' + tweet.text + '"');

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


/* Main body */
var log = bunyan.createLogger({
    name: config.bunyan_name,
    streams: config.bunyan_streams
});
var imageCache = null;
var requestingImage = false;

log.info('Tracking "' + config.track_keyword + '"');
if (config.do_not_respond) {
    log.warn('do_not_respond is on. Won\'t send responses');
}
if (!config.set_reply_id) {
    log.warn('set_reply_id is off. Tweets won\'t be responses');
}
startCacheUpdater();
startTwitterStream();
