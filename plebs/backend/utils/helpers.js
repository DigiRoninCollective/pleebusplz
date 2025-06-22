/**
 * Utility helper functions for backend operations.
 */

// Example: Capitalize the first letter of a string
function capitalize(str) {
    if (typeof str !== 'string' || !str.length) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Example: Generate a random integer between min and max (inclusive)
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    capitalize,
    randomInt,
};