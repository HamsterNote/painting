const React = require('react');

const makeMockComponent = (tag) => {
  return ({ children, testID, style, ...props }) =>
    React.createElement(tag, { style, 'data-testid': testID, ...props }, children);
};

const View = makeMockComponent('view');
const Text = makeMockComponent('text');
const TouchableOpacity = makeMockComponent('TouchableOpacity');
const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => (Array.isArray(style) ? Object.assign({}, ...style) : style),
};
const Platform = { OS: 'web', select: (obj) => obj.web || obj.default };

const ReactNative = {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
};

module.exports = ReactNative;
module.exports.default = ReactNative;
