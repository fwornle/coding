# ComponentReusableUiBuildingBlocks
**Type:** general
**Generated:** 2026-01-24T09:43:22.357Z

{
  "summary": "Mock: Code structure analyzed",
  "codePatterns": [
    {
      "pattern": "Singleton",
      "location": "src/services",
      "confidence": 0.92
    },
    {
      "pattern": "Factory",
      "location": "src/factories",
      "confidence": 0.88
    }
  ],
  "dependencies": [
    {
      "from": "ServiceA",
      "to": "ServiceB",
      "type": "dependency"
    },
    {
      "from": "Controller",
      "to": "ServiceA",
      "type": "uses"
    }
  ],
  "entities": [
    {
      "name": "MockClass_ServicePattern",
      "type": "Pattern",
      "significance": 6
    }
  ]
}