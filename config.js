// Note: This is a JavaScript file.
// This means it can contain anything including reading environmental variables..
// no need to have fancy bash init scripts
var fs = require('fs');


module.exports = {
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

    // Do not respond to tweets.. Used in debugging
    do_not_respond: false,

    // Retry?
    // Here for completness. Probably don't use it unless you want to be sure your photos get delivered at the
    // price of a huge error log and pain. Also it's kind o' untested so use at your own risk.
    retry_on_failure: false,

    // The stuff to overlay on top or on the sides of the picture
    // See https://github.com/mgoszcz2/waterstamp/blob/master/test/main.js for more examples
    // The following appends an image of a puffin in a white box
    image_template: {
        append: [
            {
                type: 'buffer',
                buffer: fs.readFileSync('public/puffin.png'),
                top: 10,
                right: 10,
                width: 571 / 6,
                height: 645 / 6
            }
        ]
    },

    // The port to start the configuration server on unless 'start_http_config' is false
    config_port: 1024,

    // The file where 'HTTP config' is located
    http_config_file: 'http-config.json',

    // Disable diffrent components of puffin
    start_http_config: true,
    start_twitter_stream: false,

    // The HTTP panel username & password
    http_config_username: 'username',
    http_config_password: 'password'
};
