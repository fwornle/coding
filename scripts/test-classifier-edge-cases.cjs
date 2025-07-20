#!/usr/bin/env node

const { AdaptiveEmbeddingClassifier } = require('./adaptive-embedding-classifier.cjs');

// Edge case test samples
const edgeCases = {
  infrastructure: `# Session Log

## Exchange 1
**User:** Fix the Docker configuration and update the deployment scripts

## Exchange 2
**Assistant:** I'll fix the Docker configuration issues. The problem is in the Dockerfile where the base image is outdated and the environment variables are not properly configured.

## Exchange 3
**User:** Update the GitHub Actions workflow for CI/CD

## Exchange 4
**Assistant:** I'll update the GitHub Actions workflow to use the latest actions and improve the build process. The workflow needs better caching and error handling.

## Exchange 5
**User:** Configure the database migration scripts and fix the connection pooling

## Exchange 6
**Assistant:** I'll configure the database migration scripts and fix the connection pooling issues. The problem is in the database configuration where the pool size is too small.`,

  pure_timeline: `# Session Log

## Exchange 1
**User:** Enhance the 3D timeline with better camera controls and smoother animations

## Exchange 2
**Assistant:** I'll enhance the timeline's 3D camera system by implementing smoother interpolation between camera positions and adding new navigation modes like orbital and fly-through views.

## Exchange 3
**User:** Add interactive timeline markers with hover effects and detailed event information

## Exchange 4
**Assistant:** I'll implement interactive timeline markers using Three.js with hover effects that display detailed event information in floating cards. This will improve user engagement with the timeline.

## Exchange 5
**User:** Implement timeline filtering by date range and event type

## Exchange 6
**Assistant:** I'll add comprehensive filtering capabilities to the timeline visualization, allowing users to filter events by date ranges, event types, and custom criteria while maintaining smooth 3D transitions.`,

  minimal_content: `# Session Log

## Exchange 1
**User:** <command-name>/sl</command-name>

## Exchange 2
**User:** Help

## Exchange 3
**Assistant:** How can I help you today?`,

  very_technical: `# Session Log

## Exchange 1
**User:** Implement a WebGL fragment shader for particle system optimization in the timeline

## Exchange 2
**Assistant:** I'll implement a custom WebGL fragment shader for the particle system to optimize rendering performance. The shader will use instanced rendering with vertex buffer objects for efficient GPU utilization.

## Exchange 3
**User:** Add SIMD optimizations to the timeline data processing pipeline

## Exchange 4
**Assistant:** I'll implement SIMD (Single Instruction, Multiple Data) optimizations using WebAssembly to accelerate the timeline data processing. This will significantly improve performance for large datasets.

## Exchange 5
**User:** Optimize the Three.js render loop with frustum culling and level-of-detail

## Exchange 6
**Assistant:** I'll implement frustum culling and LOD (Level of Detail) systems in the Three.js render loop to optimize performance by only rendering visible objects and reducing detail for distant elements.`,

  debugging_session: `# Session Log

## Exchange 1
**User:** Debug the timeline crash when loading large datasets

## Exchange 2
**Assistant:** I'll investigate the timeline crash issue when loading large datasets. The problem appears to be memory-related, likely due to inefficient Three.js object disposal or excessive geometry creation.

## Exchange 3
**User:** Fix the memory leak in the timeline event rendering system

## Exchange 4
**Assistant:** I'll fix the memory leak by properly disposing of Three.js geometries and materials, implementing object pooling for event cards, and adding proper cleanup in the component unmount lifecycle.

## Exchange 5
**User:** Resolve the timeline synchronization issues between Redux state and Three.js objects

## Exchange 6
**Assistant:** I'll resolve the synchronization issues by implementing a proper state management pattern that ensures Three.js objects are updated correctly when Redux state changes, preventing desynchronization.`
};

async function runEdgeCaseTests() {
  console.log('🔬 Testing Adaptive Classifier Edge Cases\n');
  
  const codingPath = '/Users/q284340/Agentic/coding';
  const timelinePath = '/Users/q284340/Agentic/timeline';
  
  const classifier = new AdaptiveEmbeddingClassifier(codingPath, [timelinePath]);
  
  console.log('🧪 Testing edge cases and special scenarios:\n');
  
  for (const [caseType, content] of Object.entries(edgeCases)) {
    console.log(`\n=== Testing ${caseType.toUpperCase().replace('_', ' ')} Case ===`);
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
      
      // Analyze results
      let analysis = '';
      switch (caseType) {
        case 'infrastructure':
          analysis = result.classification === 'coding' ? '✓ Correctly identified as infrastructure/coding' : '? Classified as project - could be valid depending on context';
          break;
        case 'pure_timeline':
          analysis = result.classification === 'project' ? '✓ Correctly identified as timeline project work' : '✗ Should be classified as project';
          break;
        case 'minimal_content':
          analysis = `? Minimal content - classification: ${result.classification} (fallback behavior expected)`;
          break;
        case 'very_technical':
          analysis = result.classification === 'project' ? '✓ Correctly identified technical timeline work as project' : '? Technical work could be either coding or project';
          break;
        case 'debugging_session':
          analysis = `? Debugging could be either - classified as: ${result.classification}`;
          break;
      }
      
      console.log(`📊 Analysis: ${analysis}`);
      
    } catch (error) {
      console.error(`❌ Error classifying ${caseType}:`, error.message);
    }
    
    console.log('\n' + '─'.repeat(80));
  }
  
  console.log('\n🎉 Edge case testing complete!');
  console.log('\n📋 Summary of classifier behavior:');
  console.log('   • Infrastructure work: Likely classified as coding');
  console.log('   • Pure timeline features: Should be classified as project');
  console.log('   • Technical timeline work: Should lean toward project');
  console.log('   • Minimal content: Uses fallback classification');
  console.log('   • Mixed/debugging: Context-dependent classification');
}

runEdgeCaseTests().catch(console.error);