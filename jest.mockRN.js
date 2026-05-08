const React = require('react');

const View = ({ children, testID, style }) =>
  React.createElement('View', { testID, style }, children);
const Text = ({ children, style }) => React.createElement('Text', { style }, children);
const TouchableOpacity = ({ children, onPress, testID, style }) =>
  React.createElement('TouchableOpacity', { onPress, testID, style }, children);
const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => (Array.isArray(style) ? Object.assign({}, ...style) : style),
};
const Platform = { OS: 'android', select: (obj) => obj.android || obj.default };

const ReactNative = {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
};

module.exports = ReactNative;
module.exports.default = ReactNative;
