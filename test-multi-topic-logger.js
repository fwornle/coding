#!/usr/bin/env node

import ConversationTopicSegmenter from './scripts/conversation-topic-segmenter.js';

// Test conversation with mixed topics
const testConversation = `# Extracted Claude Code Conversation

**Session ID:** test-session  
**Summary:** Mixed topic session  
**Start Time:** 2025-07-20  
**Total Messages:** 6

---

## Exchange 1

**User:** I need to check the session logs to understand what we did last time

**Assistant:** I'll read the session logs for you...

---

## Exchange 2

**User:** Great, now let's continue working on the timeline React to Kotlin migration

**Assistant:** I'll help you with the Kotlin Compose migration for the timeline project...

---

## Exchange 3

**User:** The migration looks good. Now I want to improve the ukb command to better handle knowledge updates

**Assistant:** Let me help you enhance the ukb knowledge management tool...

---

## Exchange 4

**User:** Also, can we add semantic analysis to the post-session logging?

**Assistant:** I'll implement semantic analysis for the logging system...

---

## Exchange 5

**User:** Let's go back to the timeline project and fix the Skia initialization issue

**Assistant:** I'll help you fix the Skia WebAssembly initialization error in the timeline project...

---

## Exchange 6

**User:** Perfect! This session covered a lot of different topics

**Assistant:** Yes, we worked on timeline migration, ukb improvements, and logging enhancements.
`;

async function test() {
  console.log('Testing conversation topic segmentation...\n');
  
  const segmenter = new ConversationTopicSegmenter();
  
  // Mock the classifier to avoid LLM calls
  segmenter.classifier.classifyContent = async (content) => {
    if (content.includes('ukb') || content.includes('logging') || content.includes('semantic')) {
      return 'coding';
    }
    return 'project';
  };
  
  // First test exchange parsing
  const exchanges = segmenter.parseConversationExchanges(testConversation);
  console.log(`Parsed ${exchanges.length} exchanges\n`);
  
  const segments = await segmenter.segmentConversation(testConversation);
  
  console.log(`Found ${segments.length} topic segments:\n`);
  
  segments.forEach((segment, index) => {
    console.log(`Segment ${index + 1}:`);
    console.log(`  Topic: ${segment.topic}`);
    console.log(`  Project: ${segment.project}`);
    console.log(`  Exchanges: ${segment.startExchange}-${segment.endExchange} (${segment.exchanges.length} total)`);
    console.log(`  Summary: ${segment.summary}`);
    console.log(`  Keywords: ${segment.keywords.join(', ')}`);
    console.log();
  });
}

test().catch(console.error);