// Note: This is a JavaScript file.
// This means it can contain anything including reading environmental variables..
// no need to have fancy bash init scripts
module.exports = {
    // Twitter API details
    consumer_key: '...',
    consumer_secret: '...',
    access_token: '...',
    access_token_secret: '...',

    // Keyword to track (doesn't need to be a hashtag)
    track_keyword: '#puffin',

    // Camera connection details
    snapshot_url: '/file.jpg', // Only jpeg supported at the moment
    endpoint_url: 'example.com:80',
    use_http_auth: true,
    http_username: 'bob',
    http_password: 'password',

    // How long to let endpoint rest before sending a new request (in ms)
    // Only change this if you truly know what you are doing
    endpoint_recovery_time: 1000 * 10,

    // How long to wait before giving up (in ms)
    // Only change this if you truly know what you are doing it takes ages for a photo to get through
    endpoint_timeout: 1000 * 30,

    // Bunyan logger settings (do not touch unless you are sysadmin-ing or know what you are doing)
    bunyan_name: 'puffin',
    bunyan_streams: [
        {
            level: 'debug', //Change this to 'info' for smaller logs (or 'warn')
            stream: process.stdout
        }
    ],

    // Add the reply parameter to responses
    // Setting to true adds the tweet to the menu that appers upon clicking the request.
    // Setting it to false makes it appear in the public timeline.
    // The app works either way since the user is @-mentioned in both cases.
    // Note: Twitter will sometimes ignore it. See below
    set_reply_id: false,

    // Template for the typical response, strongly recommended to prepend $handle with an '@' sign..
    // because if 'set_reply_id' is false the user will have no notfication about the response.
    // Also if 'set_reply_id' is true Twitter will not count an update as a reply is it isn't included.
    response_template: "Hi @$handle. Here's your photo!",

    // Do not respond to tweets.. Used in debugging
    do_not_respond: false,

    // Retry?
    // Here for completness. Probably don't use it unless you want to be sure your photos get delivered at the
    // price of a huge error log and pain. Also it's kind o' untested so use at your own risk.
    retry_on_failure: false
};
