import json, os
path = 'test-results/results.json'
if not os.path.exists(path):
    print('FLAKY=')
    raise SystemExit(0)
data = json.load(open(path))
flaky = []
for suite in data.get('suites', []):
    for spec in suite.get('specs', []):
        for test in spec.get('tests', []):
            results = test.get('results') or []
            if len(results) > 1 and results[-1].get('status') == 'passed':
                flaky.append(spec.get('title', 'unknown'))
print('FLAKY=' + ','.join(flaky))
