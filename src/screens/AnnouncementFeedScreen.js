import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import AnnouncementFeed from '../components/AnnouncementFeed';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';

export default function AnnouncementFeedScreen() {
  const { urgentMemos = [] } = useData();

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AnnouncementFeed items={urgentMemos} variant="feed" />
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
});