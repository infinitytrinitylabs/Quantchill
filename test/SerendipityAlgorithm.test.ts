import test from 'node:test';
import assert from 'node:assert/strict';
import { SerendipityAlgorithm, type LatentProfile } from '../src/services/SerendipityAlgorithm';

const me: LatentProfile = {
  userId: 'me',
  latentVector: [0.9, 0.8, 0.85, 0.2],
  region: 'NA',
  age: 27,
  demographicTags: ['creative', 'night-owl']
};

test('SerendipityAlgorithm returns highly compatible candidates outside usual filters as Rare Connections', () => {
  const algorithm = new SerendipityAlgorithm({ minCompatibility: 0.7 });
  const results = algorithm.rankRareConnections(
    me,
    [
      {
        userId: 'outside-high',
        latentVector: [0.88, 0.79, 0.86, 0.22],
        region: 'EU',
        age: 35,
        demographicTags: ['explorer']
      },
      {
        userId: 'inside-high',
        latentVector: [0.87, 0.8, 0.82, 0.25],
        region: 'NA',
        age: 28,
        demographicTags: ['creative']
      }
    ],
    {
      regions: ['NA'],
      ageRange: { min: 24, max: 30 },
      demographicTags: ['creative']
    }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.candidate.userId, 'outside-high');
  assert.equal(results[0]?.label, 'Rare Connection');
  assert.equal(results[0]?.isOutsideUsualFilters, true);
  assert.ok(results[0]!.reasons.some((reason) => reason.includes('outside preferred region')));
});

test('SerendipityAlgorithm filters out low-compatibility candidates even when out-of-pattern', () => {
  const algorithm = new SerendipityAlgorithm({ minCompatibility: 0.75 });
  const results = algorithm.rankRareConnections(
    me,
    [
      {
        userId: 'outside-low',
        latentVector: [0.05, 0.08, 0.03, 0.9],
        region: 'APAC',
        age: 41,
        demographicTags: ['adventure']
      }
    ],
    {
      regions: ['NA'],
      ageRange: { min: 24, max: 30 },
      demographicTags: ['creative']
    }
  );

  assert.equal(results.length, 0);
});

test('SerendipityAlgorithm ranks by blended score when multiple rare candidates qualify', () => {
  const algorithm = new SerendipityAlgorithm({ minCompatibility: 0.6, outOfPatternWeight: 0.3 });
  const results = algorithm.rankRareConnections(
    me,
    [
      {
        userId: 'rare-a',
        latentVector: [0.86, 0.77, 0.82, 0.2],
        region: 'EU',
        age: 31,
        demographicTags: ['maker']
      },
      {
        userId: 'rare-b',
        latentVector: [0.92, 0.8, 0.86, 0.2],
        region: 'EU',
        age: 35,
        demographicTags: ['traveler']
      }
    ],
    {
      regions: ['NA'],
      ageRange: { min: 24, max: 30 },
      demographicTags: ['creative']
    }
  );

  assert.equal(results.length, 2);
  assert.ok(results[0]!.score >= results[1]!.score);
});
