import Vue from 'vue';
import moment from 'moment-timezone';

/**
 * Rounds a number using Math.round
 *
 * @example
 * '{{ 1234.56 | round(0) }}'
 * this.$options.filters.round(1234.56, 0);
 *
 * @param {number} value  The number to round
 * @param {int} decimals  The number of decimals to preserve, default = 0
 * @returns {decimal}     The number rounded to the requested number of decimal places
 */
export const round = function (value, decimals) {
  if (isNaN(value)) { return 0; }

  if (!value) { value = 0; }

  if (!decimals) { decimals = 0; }

  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
};
Vue.filter('round', round);

/**
 * Adds commas to a number so it's easier to read
 *
 * @example
 * '{{ 123456789 | commaString }}'
 * this.$options.filters.commaString(123456789);
 *
 * @param {int} input The number to add commas to
 * @returns {string}  The number string with commas
 */
export const commaString = function (input) {
  if (isNaN(input)) { return 0; }

  const parts = input.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};
Vue.filter('commaString', commaString);

/**
 * Rounds a number then adds commas so it's easier to read
 *
 * @example
 * '{{ 123456789 | roundCommaString }}'
 * this.$options.filters.roundCommaString(123456789);
 *
 * @param {int} input     The number to add commas to
 * @param {int} decimals  The number of decimals to preserve, default = 0
 * @returns {string}      The number string with commas
 */
export const roundCommaString = function (input, decimals) {
  if (isNaN(input)) { return 0; }

  if (!decimals) { decimals = 0; }

  return commaString(round(input, decimals));
};
Vue.filter('roundCommaString', roundCommaString);

/**
 * Parses ipv6
 *
 * @example
 * '{{ ipv6 | extractIPv6String }}'
 * this.$options.filters.extractIPv6String(ipv6);
 *
 * @param {int} ipv6  The ipv6 value
 * @returns {string}  The human understandable ipv6 string
 */
export const extractIPv6String = function (ipv6) {
  if (!ipv6) { return ''; }

  ipv6 = ipv6.toString();

  let ip = ipv6.match(/.{1,4}/g).join(':').replace(/:0{1,3}/g, ':').replace(/^0000:/, '0:');
  [/(^|:)0:0:0:0:0:0:0:0($|:)/,
    /(^|:)0:0:0:0:0:0:0($|:)/,
    /(^|:)0:0:0:0:0:0($|:)/,
    /(^|:)0:0:0:0:0($|:)/,
    /(^|:)0:0:0:0($|:)/,
    /(^|:)0:0:0($|:)/,
    /(^|:)0:0($|:)/]
    .every(function (re) {
      if (ipv6.match(re)) {
        ip = ipv6.replace(re, '::');
        return false;
      }
      return true;
    });

  return ip;
};
Vue.filter('extractIPv6String', extractIPv6String);

/**
 * Displays the protocol string instead of number code
 *
 * @example
 * '{{ 1 | protocol }}'
 * this.$options.filters.protocol(1);
 *
 * @param {int} protocolCode  The protocol code
 * @returns {string}          The human understandable protocol string
 */
export const protocol = function (protocolCode) {
  const lookup = { 1: 'icmp', 2: 'igmp', 6: 'tcp', 17: 'udp', 47: 'gre', 50: 'esp', 58: 'icmp6', 89: 'ospf', 103: 'pim', 132: 'sctp' };

  return lookup[protocolCode] || protocolCode;
};
Vue.filter('protocol', protocol);

/**
 * Modifies a number to display the <=4 char human readable version of bits
 * Modified http://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable
 *
 * @example
 * '{{ 1524680821 | humanReadableBits }}'
 * this.$options.filters.humanReadableBits(1524680821);
 *
 * @param {int} fileSizeInBits The number to make human readable
 * @returns {string}           The <=4 char human readable number
 */
export const humanReadableBits = function (fileSizeInBits) {
  fileSizeInBits = parseInt(fileSizeInBits);

  if (isNaN(fileSizeInBits)) { return '0'; }

  let i = 0;
  const bitUnits = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  while (fileSizeInBits >= 1024) {
    fileSizeInBits = fileSizeInBits / 1024;
    i++;
  }

  if (i === 0 || fileSizeInBits >= 10) {
    return fileSizeInBits.toFixed(0) + bitUnits[i];
  } else {
    return fileSizeInBits.toFixed(1) + bitUnits[i];
  }
};
Vue.filter('humanReadableBits', humanReadableBits);

/**
 * Modifies a number to display the <=4 char human readable version of bytes
 * Modified http://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable
 *
 * @example
 * '{{ 1524680821 | humanReadableBytes }}'
 * this.$options.filters.humanReadableBytes(1524680821);
 *
 * @param {int} fileSizeInBytes The number to make human readable
 * @returns {string}            The <=4 char human readable number
 */
export const humanReadableBytes = function (fileSizeInBytes) {
  fileSizeInBytes = parseInt(fileSizeInBytes);

  if (isNaN(fileSizeInBytes)) { return '0'; }

  let i = 0;
  const byteUnits = ['Bi', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yi'];
  while (fileSizeInBytes >= 1000) {
    fileSizeInBytes = fileSizeInBytes / 1024;
    i++;
  }

  if (i === 0 || fileSizeInBytes >= 10) {
    return fileSizeInBytes.toFixed(0) + byteUnits[i];
  } else {
    return fileSizeInBytes.toFixed(1) + byteUnits[i];
  }
};
Vue.filter('humanReadableBytes', humanReadableBytes);

/**
 * Modifies a number to display the <=4 char human readable version of bytes
 * Modified http://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable
 *
 * @example
 * '{{ 1524680821 | humanReadableNumber }}'
 * this.$options.filters.humanReadableNumber(1524680821);
 *
 * @param {int} num   The number to make human readable
 * @returns {string}  The <=4 char human readable number
 */
export const humanReadableNumber = function (num) {
  if (isNaN(num)) { return '0 '; }

  let i = 0;
  const units = [' ', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  while (num >= 1000) {
    num = num / 1000;
    i++;
  }

  if (i === 0 || num >= 10) {
    return num.toFixed(0) + units[i];
  } else {
    return num.toFixed(1) + units[i];
  }
};
Vue.filter('humanReadableNumber', humanReadableNumber);

/**
 * Parses date to string and applies the selected timezone
 *
 * @example
 * '{{ 1524680821 | timezoneDateString("local", false) }}'
 * this.$options.filters.timezoneDateString(1524680821, "local", false);
 *
 * @param {int} ms           The time in milliseconds from epoch
 * @param {string} timezone  The timezone to use ('gmt', 'local', or 'localtz'), default = 'local'
 * @returns {string}         The date formatted and converted to the requested timezone
 */
export const timezoneDateString = function (ms, timezone, showMs) {
  if (isNaN(ms)) { return 'Invalid date'; }

  let format = showMs ? 'YYYY/MM/DD HH:mm:ss.SSS z' : 'YYYY/MM/DD HH:mm:ss z';

  if (timezone === 'gmt') {
    return moment.tz(ms, 'utc').format(format);
  } else if (timezone === 'localtz') {
    return moment.tz(ms, Intl.DateTimeFormat().resolvedOptions().timeZone).format(format);
  }

  format = showMs ? 'YYYY/MM/DD HH:mm:ss.SSS' : 'YYYY/MM/DD HH:mm:ss';
  return moment(ms).format(format);
};
Vue.filter('timezoneDateString', timezoneDateString);

/**
 * Turns milliseconds into a human readable time range
 *
 * @example
 * '{{ 1524680821790 | readableTime }}'
 * this.$options.filters.readableTime(1524680821790);
 *
 * @param {int} ms    The time in ms from epoch
 * @returns {string}  The human readable time range
 *                    Output example: 1 day 10:42:01
 */
export const readableTime = function (ms) {
  if (isNaN(ms)) { return '?'; }

  const seconds = parseInt((ms / 1000) % 60);
  const minutes = parseInt((ms / (1000 * 60)) % 60);
  const hours = parseInt((ms / (1000 * 60 * 60)) % 24);
  const days = parseInt((ms / (1000 * 60 * 60 * 24)));

  let result = '';

  if (days) {
    result += days + ' day';
    if (days > 1) {
      result += 's ';
    } else {
      result += ' ';
    }
  }

  if (hours || minutes || seconds) {
    result += (hours < 10) ? '0' + hours : hours;
    result += ':';
    result += (minutes < 10) ? '0' + minutes : minutes;
    result += ':';
    result += (seconds < 10) ? '0' + seconds : seconds;
  }

  return result || '0';
};
Vue.filter('readableTime', readableTime);

/**
 * Turns milliseconds into a human readable time range
 *
 * @example
 * '{{ 1524680821790 | readableTime }}'
 * this.$options.filters.readableTimeCompact(1524680821790);
 *
 * @param {int} ms    The time in ms from epoch
 * @returns {string}  The human readable time range
 *                    Output example: 1 day 10:42:01
 */
export const readableTimeCompact = function (ms) {
  if (isNaN(ms)) { return '?'; }

  const hours = parseInt((ms / (1000 * 60 * 60)) % 24);
  const days = parseInt((ms / (1000 * 60 * 60 * 24)));

  let result = '';

  if (days) {
    result += days + 'd ';
  }
  result += hours + 'h';
  return result;
};
Vue.filter('readableTimeCompact', readableTimeCompact);

/**
 * Searches fields for a term
 * Looks for the term in field friendlyName, exp, and aliases
 *
 * @example
 * '{{ searchTerm | searchFields(fields, true) }}'
 * this.$options.filters.searchFields('test', this.fields, true);
 *
 * @param {string} searchTerm       The string to search for within the fields
 * @param {array} fields            The list of fields to search
 * @param {boolean} excludeTokens   Whether to exclude token fields
 * @param {boolean} excludeFilename Whether to exclude the filename field
 * @param {boolean} excludeInfo     Whether to exclude the special info "field"
 * @returns {array}                 An array of fields that match the search term
 */
export const searchFields = function (searchTerm, fields, excludeTokens, excludeFilename, excludeInfo) {
  if (!searchTerm) { searchTerm = ''; }
  return fields.filter((field) => {
    if (field.regex !== undefined || field.noFacet === 'true') {
      return false;
    }

    if (excludeTokens && field.type && field.type.includes('textfield')) {
      return false;
    }

    if (excludeFilename && field.type && field.type === 'fileand') {
      return false;
    }

    if (excludeInfo && field.exp === 'info') {
      return false;
    }

    searchTerm = searchTerm.toLowerCase();
    return field.friendlyName.toLowerCase().includes(searchTerm) ||
      field.exp.toLowerCase().includes(searchTerm) ||
      (field.aliases && field.aliases.some(item => {
        return item.toLowerCase().includes(searchTerm);
      }));
  });
};
Vue.filter('searchFields', searchFields);

/**
 * Builds an expression for search.
 * Stringifies necessary values and escapes necessary characters
 *
 * @example
 * '{{ 'ip.dst' | buildExpression('10.0.0.1', '==') }}'
 * this.$options.filters.buildExpression('ip.dst', '10.0.0.1', '==');
 *
 * @param {string} field  The field name
 * @param {string} value  The field value
 * @param {string} op     The relational operator
 * @returns {string}      The fully built expression
 */
export const buildExpression = function (field, value, op) {
  // for values required to be strings in the search expression
  /* eslint-disable no-useless-escape */
  const needQuotes = (value !== 'EXISTS!' && !(value.startsWith('[') && value.endsWith(']')) &&
    /[^-+a-zA-Z0-9_.@:*?/,]+/.test(value)) ||
    (value.startsWith('/') && value.endsWith('/'));

  // escape unescaped quotes
  value = value.toString().replace(/\\([\s\S])|(")/g, '\\$1$2');
  if (needQuotes) { value = `"${value}"`; }

  return `${field} ${op} ${value}`;
};
Vue.filter('buildExpression', buildExpression);

/**
 * Searches cluster for a term
 * Looks for the term in a list of cluster
 *
 * @example
 * '{{ searchTerm | searchCluster(cluster) }}'
 * this.$options.filters.searchCluster('ES1', ['ES1', 'ES2', 'ES3']);
 *
 * @param {string} searchTerm The string to search for within the fields
 * @param {array} clusters    The list of cluster to search
 * @returns {array}           An array of cluster that match the search term
 */
export const searchCluster = function (searchTerm, clusters) {
  if (!searchTerm) { searchTerm = ''; }
  return clusters.filter((cluster) => {
    searchTerm = searchTerm.toLowerCase();
    return cluster.toLowerCase().includes(searchTerm);
  });
};
Vue.filter('searchCluster', searchCluster);
