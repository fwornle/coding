#!/usr/bin/env node

const { AdaptiveEmbeddingClassifier } = require('./adaptive-embedding-classifier.cjs');

// Test content samples representing different session types
const testSamples = {
  coding: `# Session Log

## Exchange 1
**User:** Fix the session logging script that's breaking the build process

## Exchange 2
**Assistant:** I'll examine the build script and fix the issues. The problem appears to be in the webpack configuration where the entry point is not properly defined.

## Exchange 3
**User:** Update the package.json dependencies and fix the TypeScript compilation errors

## Exchange 4
**Assistant:** I'll update the dependencies and resolve the TypeScript compilation errors by fixing the type definitions and updating the tsconfig.json file.

## Exchange 5
**User:** Debug the CI/CD pipeline that's failing on the deployment step

## Exchange 6
**Assistant:** I'll investigate the deployment pipeline failures. The issue is in the Docker configuration where the environment variables are not properly passed to the container.`,

  timeline: `# Session Log

## Exchange 1
**User:** Add a new camera mode to the 3D timeline visualization for better user navigation

## Exchange 2
**Assistant:** I'll implement a new camera mode for the timeline visualization. This will involve updating the TimelineCamera component and adding the new mode to the camera state management system.

## Exchange 3
**User:** Improve the timeline event card animations and make them more responsive

## Exchange 4
**Assistant:** I'll enhance the timeline event card animations by optimizing the Three.js animation system and improving the card opening/closing transitions for better user experience.

## Exchange 5
**User:** Add metrics visualization to show project activity over time in the timeline

## Exchange 6
**Assistant:** I'll implement a metrics visualization component that displays project activity data integrated with the timeline. This will show commit frequency, file changes, and other development metrics.`,

  mixed: `# Session Log

## Exchange 1
**User:** Fix the TypeScript build errors in the timeline project

## Exchange 2
**Assistant:** I'll fix the TypeScript compilation errors in the timeline visualization project. The issues are related to Three.js type definitions and Redux state typing.

## Exchange 3
**User:** Update the CI/CD pipeline for the timeline deployment

## Exchange 4
**Assistant:** I'll update the deployment pipeline configuration to properly build and deploy the timeline application with the new 3D visualization features.

## Exchange 5
**User:** Add new timeline event visualization features

## Exchange 6
**Assistant:** I'll implement new event visualization features for the timeline, including enhanced 3D markers and improved event card interactions.`
};

async function runTests() {
  console.log('🔍 Testing Adaptive Embedding Classifier\n');
  
  // Initialize classifier with coding and timeline project paths
  const codingPath = '/Users/q284340/Agentic/coding';
  const timelinePath = '/Users/q284340/Agentic/timeline';
  
  const classifier = new AdaptiveEmbeddingClassifier(codingPath, [timelinePath]);
  
  console.log('📊 Testing different session types:\n');
  
  for (const [sessionType, content] of Object.entries(testSamples)) {
    console.log(`\n=== Testing ${sessionType.toUpperCase()} Session ===`);
    console.log(`Content preview: ${content.substring(0, 100)}...\n`);
    
    try {
      const result = await classifier.classifyContent(content);
      
      console.log(`🎯 Classification: ${result.classification}`);
      console.log(`🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`📈 Coding Score: ${result.coding_score?.toFixed(3) || 'N/A'}`);
      console.log(`📈 Project Score: ${result.project_score?.toFixed(3) || 'N/A'}`);
      console.log(`💭 Reasoning: ${result.reasoning}`);
      
      if (result.best_coding_match) {
        console.log(`🔍 Best Coding Match (${result.best_coding_match.similarity.toFixed(3)}): ${result.best_coding_match.sample}`);
      }
      
      if (result.best_project_match) {
        console.log(`🔍 Best Project Match (${result.best_project_match.similarity.toFixed(3)}): ${result.best_project_match.sample}`);
      }
      
      // Verify expected classification
      let expected = sessionType === 'coding' ? 'coding' : 'project';
      if (sessionType === 'mixed') {
        expected = 'either coding or project'; // Mixed can go either way
      }
      
      const isCorrect = sessionType === 'mixed' || result.classification === expected;
      console.log(`✅ Expected: ${expected}, Got: ${result.classification} ${isCorrect ? '✓' : '✗'}`);
      
    } catch (error) {
      console.error(`❌ Error classifying ${sessionType} session:`, error.message);
    }
    
    console.log('\n' + '─'.repeat(80));
  }
  
  console.log('\n🏁 Classification testing complete!');
}

runTests().catch(console.error);