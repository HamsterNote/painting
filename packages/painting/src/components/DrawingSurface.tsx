import { Text, View } from 'react-native';

export type DrawingSurfaceProps = {
  testID?: string;
};

export function DrawingSurface({ testID }: DrawingSurfaceProps) {
  return (
    <View testID={testID}>
      <Text>DrawingSurface placeholder</Text>
    </View>
  );
}
