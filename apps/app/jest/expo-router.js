const { createElement, Fragment } = require('react');

// Draws the header buttons a screen hands to the stack, so tests can press them.
const Stack = {
  Screen: ({ options }) => createElement(Fragment, null, options?.headerLeft?.(), options?.headerRight?.()),
};

const Link = ({ children }) => children;

module.exports = { router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }, Link, Stack };
