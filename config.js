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

    // Do not respond to tweets.. Used in debugging
    do_not_respond: false,

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
    config_port: 8000,

    // The file where 'HTTP config' is located
    http_config_file: 'http-config.json',

    // Disable diffrent components of puffin
    start_http_config: true,
    start_twitter_stream: true
};
