import {
  isAndroidInkProbeAvailable,
  PaintingAndroidInkView,
  type AndroidInkProbeReady,
} from '@hamster-note/painting-android-ink';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AndroidInkProbeRoute() {
  const [ready, setReady] = useState<AndroidInkProbeReady>();
  const [pending, setPending] = useState<number[]>([]);
  const [retireId, setRetireId] = useState(0);
  const [cancelled, setCancelled] = useState('');
  if (!isAndroidInkProbeAvailable()) {
    return (
      <SafeAreaView style={styles.root}>
        <Text>Android Ink A0: rebuild the Android development client (probe version 1).</Text>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Android Ink A0</Text>
      <Text testID="android-ink-ready">
        {ready
          ? `Ink ${ready.inkVersion} / API ${ready.sdkInt} / density ${ready.density} / ${ready.widthPx} x ${ready.heightPx}px`
          : 'Waiting for native view'}
      </Text>
      <Text testID="android-ink-pending">Pending: {pending.join(', ') || '0'}</Text>
      <Text testID="android-ink-cancelled">{cancelled}</Text>
      <Button
        title="Retire earliest stroke"
        disabled={pending.length === 0 || pending.includes(retireId)}
        onPress={() => setRetireId(pending[0])}
      />
      <View style={styles.surface}>
        <View style={styles.crosshair} pointerEvents="none" />
        <PaintingAndroidInkView
          testID="android-ink-surface"
          style={StyleSheet.absoluteFill}
          retireId={retireId}
          onReady={({ nativeEvent }) => setReady(nativeEvent)}
          onStrokeFinished={({ nativeEvent }) => {
            const { id } = nativeEvent;
            setPending((previous) =>
              previous.includes(id) ? previous : [...previous, id].slice(-4)
            );
          }}
          onRetired={({ nativeEvent }) => {
            const { id } = nativeEvent;
            setPending((previous) => previous.filter((value) => value !== id));
          }}
          onCancelled={({ nativeEvent }) => setCancelled(nativeEvent.reason)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 8, backgroundColor: '#ffffff' },
  title: { fontSize: 20, fontWeight: '600' },
  surface: { flex: 1, minHeight: 180, backgroundColor: '#f0f6f2' },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#a7ada9',
  },
});
