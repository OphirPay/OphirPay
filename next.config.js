const withTM = require('next-transpile-modules')(['@scalar/nextjs-api-reference']);

module.exports = withTM({
  reactStrictMode: true,
  // other configurations
});
