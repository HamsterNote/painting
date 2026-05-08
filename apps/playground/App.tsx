import { View, Text, StyleSheet } from 'react-native';
import { DrawingSurface } from '@hamster-note/painting';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Playground Ready</Text>
      <View style={styles.surfaceSlot} testID="drawing-surface-smoke">
        <DrawingSurface />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  surfaceSlot: {
    width: 300,
    height: 300,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
