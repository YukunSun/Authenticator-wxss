/*jshint esversion: 6 */
(() => {
    'use strict';
    var base32 = require('./base32.js');
    var CryptoJS = require('./CryptoJS.js');
    var Buffer = require('./Buffer.js');

    /**
     * Digest the one-time passcode options.
     *
     * @param {Object} options
     * @param {String} options.secret Shared secret key
     * @param {Integer} options.counter Counter value
     * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
     *   base32, base64).
     * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
     *   sha512).
     * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
     *   Shared secret key
     * @return {Buffer} The one-time passcode as a buffer.
     */

    exports.digest = function digest(options) {
        var i;

        // unpack options
        var secret = options.secret;
        var counter = options.counter;
        var encoding = options.encoding || 'ascii';
        var algorithm = (options.algorithm || 'sha1').toLowerCase();

        // Backwards compatibility - deprecated
        if (options.key !== null) {
            console.warn('Speakeasy - Deprecation Notice - Specifying the secret using `key` is no longer supported. Use `secret` instead.');
            secret = options.key;
        }

        // convert secret to buffer
        if (!Buffer.isBuffer(secret)) {
            secret = (encoding === 'base32') ? base32.decode(secret) : new Buffer(secret, encoding);
        }

        var secret_buffer_size;
        if (algorithm === 'sha1') {
            secret_buffer_size = 20; // 20 bytes
        } else if (algorithm === 'sha256') {
            secret_buffer_size = 32; // 32 bytes
        } else if (algorithm === 'sha512') {
            secret_buffer_size = 64; // 64 bytes
        } else {
            console.warn('Speakeasy - The algorithm provided (`' + algorithm + '`) is not officially supported, results may be different than expected.');
        }

        // The secret for sha1, sha256 and sha512 needs to be a fixed number of bytes for the one-time-password to be calculated correctly
        // Pad the buffer to the correct size be repeating the secret to the desired length
        if (secret_buffer_size && secret.length !== secret_buffer_size) {
            secret = new Buffer(Array(Math.ceil(secret_buffer_size / secret.length) + 1).join(secret.toString('hex')), 'hex').slice(0, secret_buffer_size);
        }

        // create an buffer from the counter
        var buf = new Buffer(8);
        var tmp = counter;
        for (i = 0; i < 8; i++) {
            // mask 0xff over number to get last 8
            buf[7 - i] = tmp & 0xff;

            // shift 8 and get ready to loop over the next batch of 8
            tmp = tmp >> 8;
        }

        // init hmac with the key
        var hmac = CryptoJS.algo.HMAC.create(CryptoJS.algo[algorithm.toUpperCase()], CryptoJS.enc.Hex.parse(secret.toString('hex')));

        // update hmac with the counter
        hmac.update(CryptoJS.enc.Hex.parse(buf.toString('hex')));

        // return the digest
        return new Buffer(hmac.finalize().toString(CryptoJS.enc.Hex), 'hex');
    };

    /**
     * Generate a counter-based one-time token. Specify the key and counter, and
     * receive the one-time password for that counter position as a string. You can
     * also specify a token length, as well as the encoding (ASCII, hexadecimal, or
     * base32) and the hashing algorithm to use (SHA1, SHA256, SHA512).
     *
     * @param {Object} options
     * @param {String} options.secret Shared secret key
     * @param {Integer} options.counter Counter value
     * @param {Buffer} [options.digest] Digest, automatically generated by default
     * @param {Integer} [options.digits=6] The number of digits for the one-time
     *   passcode.
     * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
     *   base32, base64).
     * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
     *   sha512).
     * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
     *   Shared secret key
     * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
     *   number of digits for the one-time passcode.
     * @return {String} The one-time passcode.
     */

    exports.hotp = function hotpGenerate(options) {

        // verify secret and counter exists
        var secret = options.secret;
        var key = options.key;
        var counter = options.counter;

        if (key === null || typeof key === 'undefined') {
            if (secret === null || typeof secret === 'undefined') {
                throw new Error('Speakeasy - hotp - Missing secret');
            }
        }

        if (counter === null || typeof counter === 'undefined') {
            throw new Error('Speakeasy - hotp - Missing counter');
        }

        // unpack digits
        // backward compatibility: `length` is also accepted here, but deprecated
        var digits = (options.digits !== null ? options.digits : options.length) || 6;
        if (options.length !== null) console.warn('Speakeasy - Deprecation Notice - Specifying token digits using `length` is no longer supported. Use `digits` instead.');

        // digest the options
        var digest = options.digest || exports.digest(options);

        // compute HOTP offset
        var offset = digest[digest.length - 1] & 0xf;

        // calculate binary code (RFC4226 5.4)
        var code = (digest[offset] & 0x7f) << 24 |
            (digest[offset + 1] & 0xff) << 16 |
            (digest[offset + 2] & 0xff) << 8 |
            (digest[offset + 3] & 0xff);

        // left-pad code
        code = new Array(digits + 1).join('0') + code.toString(10);

        // return length number off digits
        return code.substr(-digits);
    };

    // Alias counter() for hotp()
    exports.counter = exports.hotp;

    /**
     * Calculate counter value based on given options. A counter value converts a
     * TOTP time into a counter value by finding the number of time steps that have
     * passed since the epoch to the current time.
     *
     * @param {Object} options
     * @param {Integer} [options.time] Time in seconds with which to calculate
     *   counter value. Defaults to `Date.now()`.
     * @param {Integer} [options.step=30] Time step in seconds
     * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
     *   which to calculate the counter value. Defaults to 0 (no offset).
     * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
     *   Initial time in seconds since the UNIX epoch from which to calculate the
     *   counter value. Defaults to 0 (no offset).
     * @return {Integer} The calculated counter value.
     * @private
     */

    exports._counter = function _counter(options) {
        var step = options.step || 30;
        var time = options.time !== null ? (options.time * 1000) : Date.now();

        // also accepts 'initial_time', but deprecated
        var epoch = (options.epoch !== null ? (options.epoch * 1000) : (options.initial_time * 1000)) || 0;
        if (options.initial_time !== null) console.warn('Speakeasy - Deprecation Notice - Specifying the epoch using `initial_time` is no longer supported. Use `epoch` instead.');

        return Math.floor((time - epoch) / step / 1000);
    };

    /**
     * Generate a time-based one-time token. Specify the key, and receive the
     * one-time password for that time as a string. By default, it uses the current
     * time and a time step of 30 seconds, so there is a new token every 30 seconds.
     * You may override the time step and epoch for custom timing. You can also
     * specify a token length, as well as the encoding (ASCII, hexadecimal, or
     * base32) and the hashing algorithm to use (SHA1, SHA256, SHA512).
     *
     * Under the hood, TOTP calculates the counter value by finding how many time
     * steps have passed since the epoch, and calls HOTP with that counter value.
     *
     * @param {Object} options
     * @param {String} options.secret Shared secret key
     * @param {Integer} [options.time] Time in seconds with which to calculate
     *   counter value. Defaults to `Date.now()`.
     * @param {Integer} [options.step=30] Time step in seconds
     * @param {Integer} [options.epoch=0] Initial time in seconds since the UNIX
     *   epoch from which to calculate the counter value. Defaults to 0 (no offset).
     * @param {Integer} [options.counter] Counter value, calculated by default.
     * @param {Integer} [options.digits=6] The number of digits for the one-time
     *   passcode.
     * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
     *   base32, base64).
     * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
     *   sha512).
     * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
     *   Shared secret key
     * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
     *   Initial time in seconds since the UNIX epoch from which to calculate the
     *   counter value. Defaults to 0 (no offset).
     * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
     *   number of digits for the one-time passcode.
     * @return {String} The one-time passcode.
     */

    exports.totp = function totpGenerate(options) {
        // shadow options
        options = Object.create(options);

        // verify secret exists if key is not specified
        var key = options.key;
        var secret = options.secret;
        if (key === null || typeof key === 'undefined') {
            if (secret === null || typeof secret === 'undefined') {
                throw new Error('Speakeasy - totp - Missing secret');
            }
        }

        // calculate default counter value
        if (options.counter === null) options.counter = exports._counter(options);

        // pass to hotp
        return this.hotp(options);
    };

    // Alias time() for totp()
    exports.time = exports.totp;
})();