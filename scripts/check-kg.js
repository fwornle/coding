const { GraphDatabaseAdapter } = require("/coding/integrations/mcp-server-semantic-analysis/dist/storage/graph-database-adapter.js");
(async () => {
  const gda = new GraphDatabaseAdapter();
  await gda.initialize();
  const entities = gda.getAllEntities();
  const withEmb = entities.filter(e => e.embedding && e.embedding.length === 384);
  const withRole = entities.filter(e => e.role);
  const withOntology = entities.filter(e => e.entityType && e.entityType !== "Unclassified");
  const byType = {};
  entities.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
  const sample = entities.slice(0, 3).map(e => ({
    name: e.name, type: e.type, entityType: e.entityType,
    role: e.role, hasEmb: !!(e.embedding && e.embedding.length > 0),
    embLen: e.embedding ? e.embedding.length : 0
  }));
  process.stdout.write(JSON.stringify({
    total: entities.length,
    withEmbeddings384: withEmb.length,
    withRole: withRole.length,
    withOntology: withOntology.length,
    byType, sample
  }, null, 2) + "\n");
})().catch(e => process.stderr.write(e.message + "\n"));
