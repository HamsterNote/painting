import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

describe('native Jest baseline', () => {
  it('renders a View and Text through React Native Testing Library', async () => {
    const result = await render(
      <View>
        <Text>Native smoke</Text>
      </View>
    );

    expect(result.getByText('Native smoke')).toBeTruthy();
  });
});
