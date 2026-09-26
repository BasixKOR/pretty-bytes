import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {promisify} from 'node:util';
import test from 'ava';
import prettyBytes from './index.js';

const DECIMAL_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
const BIT_UNITS = ['b', 'kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit', 'Ebit', 'Zbit', 'Ybit'];
const BIBIT_UNITS = ['b', 'kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit', 'Eibit', 'Zibit', 'Yibit'];
const execFileAsync = promisify(execFile);
const testWithLocaleOverride = process.platform === 'win32' ? test.skip : test;

/*
Pulls every `prettyBytes` example out of the documentation so the docs cannot drift away from the behavior.
The runnable fences are returned as well, so the test can insist that each one actually demonstrates something.
*/
const documentedExamples = filePath => {
	const source = readFileSync(filePath, 'utf8');
	const examples = [];
	const blocks = [];

	// The fences are tagged with `js` in the readme and bare in the type definitions, and only `readme.md` has other languages.
	for (const match of source.matchAll(/^[ \t]*```(\w*)\n([\S\s]*?)^[ \t]*```[ \t]*$/gm)) {
		const [, language, block] = match;

		if (language !== '' && language !== 'js') {
			continue;
		}

		blocks.push(block);
		let code = '';

		for (const line of block.split('\n')) {
			const trimmed = line.trim();

			if (trimmed.startsWith('//=>')) {
				examples.push([code, trimmed.slice('//=>'.length).trim()]);
				code = '';
			} else if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('import ')) {
				code += `${trimmed}\n`;
			}
		}
	}

	return {blocks, examples};
};

// Deliberately loose, so that a misspelled marker is counted here and then fails to produce an example.
const documentedMarkers = blocks => (blocks.join('\n').match(/\/\/\s*=>/g) ?? []).length;

// Compares digits only, so the grouping and decimal separators do not matter.
const digitsOf = value => value.replaceAll(/\D/g, '');

test('throws on invalid input', t => {
	t.throws(() => {
		prettyBytes('');
	});

	t.throws(() => {
		prettyBytes('1');
	});

	t.throws(() => {
		prettyBytes(Number.NaN);
	});

	t.throws(() => {
		prettyBytes(true);
	});

	t.throws(() => {
		prettyBytes(Number.POSITIVE_INFINITY);
	});

	t.throws(() => {
		prettyBytes(Number.NEGATIVE_INFINITY);
	});

	t.throws(() => {
		prettyBytes(null);
	});

	// Invalid fixedWidth
	t.throws(() => {
		prettyBytes(1337, {fixedWidth: -1});
	});

	t.throws(() => {
		prettyBytes(1337, {fixedWidth: 1.5});
	});
});

test('validates the options before scaling the value', t => {
	// The options are validated before anything is scaled, so an invalid option is reported even for a value no `number` can hold.
	for (const options of [{fixedWidth: -1}, {maximumFractionDigits: 1.5}, {minimumFractionDigits: -1}]) {
		t.throws(() => {
			prettyBytes(10n ** 400n, options);
		}, {instanceOf: TypeError});
	}

	t.throws(() => {
		prettyBytes(10n ** 400n, {fixedWidth: '8'});
	}, {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got string: 8',
	});
});

// TODO: Unskip when targeting Node.js 22. Node.js 20 only accepts up to 20 fraction digits in `Intl.NumberFormat`.
// eslint-disable-next-line ava/no-skip-test
test.skip('throws on invalid fraction digit options', t => {
	// `Intl.NumberFormat` silently truncates non-integers, so these are rejected instead of quietly changing the output.
	for (const name of ['minimumFractionDigits', 'maximumFractionDigits']) {
		for (const value of [-1, 1.5, 0.5, 101, Number.NaN, Number.POSITIVE_INFINITY, '2', null, true]) {
			t.throws(() => {
				prettyBytes(1337, {[name]: value});
			}, {
				instanceOf: TypeError,
				message: `Expected ${name} to be an integer between 0 and 100, got ${typeof value}: ${value}`,
			});
		}
	}

	// The signed zero shortcut must not skip the validation.
	t.throws(() => {
		prettyBytes(0, {signed: true, maximumFractionDigits: 1.5});
	}, {instanceOf: TypeError});

	t.throws(() => {
		prettyBytes(0n, {signed: true, minimumFractionDigits: -1});
	}, {instanceOf: TypeError});

	// `undefined` means "not set" and stays valid.
	t.is(prettyBytes(1337, {minimumFractionDigits: undefined, maximumFractionDigits: undefined}), '1.34 kB');
	t.is(prettyBytes(1337, {minimumFractionDigits: 0, maximumFractionDigits: 0}), '1 kB');
	t.is(prettyBytes(1337, {minimumFractionDigits: 100}), `1.337${'0'.repeat(97)} kB`);

	// A minimum above the maximum is rejected, including for a value past the number range, which never reaches `Intl.NumberFormat`.
	for (const value of [1337, 1337n, 10n ** 400n]) {
		t.throws(() => {
			prettyBytes(value, {minimumFractionDigits: 4, maximumFractionDigits: 2});
		}, {
			instanceOf: RangeError,
			message: 'Expected minimumFractionDigits (4) to not be greater than maximumFractionDigits (2)',
		});
	}

	t.is(prettyBytes(1337, {minimumFractionDigits: 2, maximumFractionDigits: 2}), '1.33 kB');
});

test('converts bytes to human readable strings', t => {
	t.is(prettyBytes(0), '0 B');
	t.is(prettyBytes(0n), '0 B');
	t.is(prettyBytes(0.4), '0.4 B');
	t.is(prettyBytes(0.7), '0.7 B');
	t.is(prettyBytes(0.001), '0.001 B');
	t.is(prettyBytes(0.0001), '0.0001 B');
	t.is(prettyBytes(0.1005), '0.101 B');
	t.is(prettyBytes(0.123_456), '0.123 B');
	t.is(prettyBytes(10), '10 B');
	t.is(prettyBytes(10n), '10 B');
	t.is(prettyBytes(10.1), '10.1 B');
	t.is(prettyBytes(999), '999 B');
	t.is(prettyBytes(999n), '999 B');
	t.is(prettyBytes(1001), '1 kB');
	t.is(prettyBytes(1001n), '1 kB');
	t.is(prettyBytes(1e16), '10 PB');
	t.is(prettyBytes(10n ** 16n), '10 PB');
	t.is(prettyBytes(1e30), '1000000 YB');
	t.is(prettyBytes(10n ** 30n), '1000000 YB');
	t.is(prettyBytes(827_181 * 1e26), '82718100 YB');
});

test('does not use exponential notation', t => {
	// `Number#toString` switches to exponential notation below 1e-6 and from 1e21 upwards.
	t.is(prettyBytes(0.000_001), '0.000001 B');
	t.is(prettyBytes(0.000_000_1), '0.0000001 B');
	t.is(prettyBytes(0.000_000_5), '0.0000005 B');
	t.is(prettyBytes(0.000_000_123_4), '0.000000123 B');
	// Rounding up out of the exponential range must still produce plain digits.
	t.is(prettyBytes(0.000_000_999_9), '0.000001 B');
	t.is(prettyBytes(-0.000_000_1), '-0.0000001 B');
	t.is(prettyBytes(0.000_000_1, {signed: true}), '+0.0000001 B');
	t.is(prettyBytes(0.000_000_1, {space: false}), '0.0000001B');
	t.is(prettyBytes(0.000_000_1, {bits: true}), '0.0000001 b');

	// 1e100 bytes is 1e76 yottabytes, which still has to be readable.
	t.is(prettyBytes(10n ** 100n), `1${'0'.repeat(76)} YB`);
	t.is(prettyBytes(10n ** 100n, {locale: false}), `1${'0'.repeat(76)} YB`);
	t.is(prettyBytes(-(10n ** 100n)), `-1${'0'.repeat(76)} YB`);
	t.is(prettyBytes(1e30), '1000000 YB');
});

test('rounding carries across every decimal unit boundary', t => {
	for (let exponent = 0; exponent < DECIMAL_UNITS.length - 1; exponent++) {
		const scale = 1000 ** exponent;
		t.is(prettyBytes(999.499 * scale), `999 ${DECIMAL_UNITS[exponent]}`);
		t.is(prettyBytes(999.5 * scale), `1 ${DECIMAL_UNITS[exponent + 1]}`);
	}
});

test('rounding carries across every binary unit boundary', t => {
	for (let exponent = 0; exponent < BINARY_UNITS.length - 1; exponent++) {
		const scale = 1024 ** exponent;
		t.is(prettyBytes(1023.499 * scale, {binary: true}), `1023 ${BINARY_UNITS[exponent]}`);
		t.is(prettyBytes(1023.5 * scale, {binary: true}), `1 ${BINARY_UNITS[exponent + 1]}`);
	}
});

test('an exact unit power is one of that unit', t => {
	// The computed exponent must not land just below a whole number, which the fraction digit options would print as `1000 TB` or `1024 TiB` since they never carry.
	for (const [base, units, options] of [[1000, DECIMAL_UNITS, {}], [1024, BINARY_UNITS, {binary: true}]]) {
		for (let exponent = 1; exponent < units.length; exponent++) {
			for (const formatting of [{}, {maximumFractionDigits: 1}, {minimumFractionDigits: 1}]) {
				const expected = `${'minimumFractionDigits' in formatting ? '1.0' : '1'} ${units[exponent]}`;
				t.is(prettyBytes(base ** exponent, {...options, ...formatting}), expected);
				t.is(prettyBytes(BigInt(base) ** BigInt(exponent), {...options, ...formatting}), expected);
			}
		}
	}
});

test('rounding carries values above unit boundary thresholds', t => {
	t.is(prettyBytes(999_999), '1 MB');
	t.is(prettyBytes(999_999n), '1 MB');
	t.is(prettyBytes(1_048_575, {binary: true}), '1 MiB');
	t.is(prettyBytes(1_048_575n, {binary: true}), '1 MiB');
});

test('a value just below a unit boundary keeps the smaller unit', t => {
	// `Math.log10(999_999_999_999_999)` rounds up to exactly 15, which used to put the exponent a whole unit too high and print `0.9 PB`. The binary boundary behaves the same way through `log`.
	for (const [value, binary, expected] of [
		[999_999_999_999_999, false, '999.9 TB'],
		[1_125_899_906_842_623, true, '1023.9 TiB'],
	]) {
		t.is(prettyBytes(value, {binary, maximumFractionDigits: 1}), expected);
		t.is(prettyBytes(BigInt(value), {binary, maximumFractionDigits: 1}), expected);
	}

	// The neighbours below the boundary are unaffected, so the pair proves the boundary moved rather than the value.
	t.is(prettyBytes(999_999_999_999_998, {maximumFractionDigits: 1}), '999.9 TB');
	t.is(prettyBytes(1_125_899_906_842_622, {binary: true, maximumFractionDigits: 1}), '1023.9 TiB');

	// Rounding to 3 significant digits still carries, because that is a real unit boundary.
	t.is(prettyBytes(999_999_999_999_999), '1 PB');
	t.is(prettyBytes(999_999_999_999_999n), '1 PB');
});

test('rounding carries BigInt values across unit boundaries', t => {
	const configurations = [
		{
			base: 1000n,
			options: {},
			units: DECIMAL_UNITS,
		},
		{
			base: 1024n,
			options: {binary: true},
			units: BINARY_UNITS,
		},
	];

	for (const {base, options, units} of configurations) {
		for (let exponent = 1; exponent < units.length - 1; exponent++) {
			const scale = base ** BigInt(exponent);
			const threshold = (((2n * base) - 1n) * scale) / 2n;
			const valueBelowThreshold = threshold - (scale / base);
			t.is(prettyBytes(valueBelowThreshold, options), `${base - 1n} ${units[exponent]}`);
			t.is(prettyBytes(threshold, options), `1 ${units[exponent + 1]}`);
		}
	}
});

test('rounding carries with presentation options', t => {
	t.is(prettyBytes(-999_500), '-1 MB');
	t.is(prettyBytes(999_500, {signed: true}), '+1 MB');
	t.is(prettyBytes(999_500, {bits: true}), '1 Mbit');
	t.is(prettyBytes(1_048_064, {bits: true, binary: true}), '1 Mibit');
	t.is(prettyBytes(999_500, {locale: 'de'}), '1 MB');
	t.is(prettyBytes(999_500, {space: false}), '1MB');
	t.is(prettyBytes(999_500, {nonBreakingSpace: true}), '1\u00A0MB');
	t.is(prettyBytes(999_500, {fixedWidth: 8}), '    1 MB');
});

test('fractional digit options do not carry across unit boundaries', t => {
	t.is(prettyBytes(999.999_999_999_999_3, {maximumFractionDigits: 1, locale: 'en'}), '999.9 B');
	t.is(prettyBytes(999_999, {maximumFractionDigits: 1, locale: 'en'}), '999.9 kB');
	t.is(prettyBytes(999_999n, {maximumFractionDigits: 1, locale: 'en'}), '999.9 kB');
	t.is(prettyBytes(999_999, {minimumFractionDigits: 1, locale: 'en'}), '999.999 kB');
	t.is(prettyBytes(1_048_575, {maximumFractionDigits: 1, binary: true, locale: 'en'}), '1,023.9 KiB');
	t.is(prettyBytes(1_048_575n, {maximumFractionDigits: 1, binary: true, locale: 'en'}), '1,023.9 KiB');
	t.is(prettyBytes(1_048_575, {minimumFractionDigits: 1, binary: true, locale: 'en'}), '1,023.999 KiB');
});

test('rounding does not carry beyond the largest unit', t => {
	const decimalScale = 1000 ** 8;
	t.is(prettyBytes(999.499 * decimalScale), '999 YB');
	t.is(prettyBytes(999.5 * decimalScale), '1000 YB');

	const decimalBigIntScale = 1000n ** 8n;
	const decimalBigIntThreshold = (1999n * decimalBigIntScale) / 2n;
	t.is(prettyBytes(decimalBigIntThreshold - (decimalBigIntScale / 1000n)), '999 YB');
	t.is(prettyBytes(decimalBigIntThreshold), '1000 YB');

	const binaryScale = 1024 ** 8;
	t.is(prettyBytes(1023.499 * binaryScale, {binary: true}), '1023 YiB');
	t.is(prettyBytes(1023.5 * binaryScale, {binary: true}), '1024 YiB');

	const binaryBigIntScale = 1024n ** 8n;
	const binaryBigIntThreshold = (2047n * binaryBigIntScale) / 2n;
	t.is(prettyBytes(binaryBigIntThreshold - (binaryBigIntScale / 1024n), {binary: true}), '1023 YiB');
	t.is(prettyBytes(binaryBigIntThreshold, {binary: true}), '1024 YiB');
});

test('supports negative number', t => {
	t.is(prettyBytes(-0.4), '-0.4 B');
	t.is(prettyBytes(-0.7), '-0.7 B');
	t.is(prettyBytes(-10.1), '-10.1 B');
	t.is(prettyBytes(-999), '-999 B');
	t.is(prettyBytes(-999n), '-999 B');
	t.is(prettyBytes(-1001), '-1 kB');
	t.is(prettyBytes(-1001n), '-1 kB');
});

test('locale option', t => {
	t.is(prettyBytes(-0.4, {locale: 'de'}), '-0,4 B');
	t.is(prettyBytes(0.4, {locale: 'de'}), '0,4 B');
	t.is(prettyBytes(1001, {locale: 'de'}), '1 kB');
	t.is(prettyBytes(1001n, {locale: 'de'}), '1 kB');
	t.is(prettyBytes(10.1, {locale: 'de'}), '10,1 B');
	t.is(prettyBytes(1e30, {locale: 'de'}), '1.000.000 YB');
	t.is(prettyBytes(10n ** 30n, {locale: 'de'}), '1.000.000 YB');
	t.is(prettyBytes(827_181 * 1e26, {locale: 'de'}), '82.718.100 YB');

	// The separator between the number and the unit is the same plain space in every locale, including one that does not use ASCII digits.
	t.is(prettyBytes(1337, {space: false, locale: 'de'}), '1,34kB');
	t.is(prettyBytes(1337, {space: false, locale: 'ar-EG'}), '١٫٣٤kB');
	t.is(prettyBytes(1337, {nonBreakingSpace: true, locale: 'ar-EG'}), '١٫٣٤ kB');

	t.is(prettyBytes(-0.4, {locale: 'en'}), '-0.4 B');
	t.is(prettyBytes(0.4, {locale: 'en'}), '0.4 B');
	t.is(prettyBytes(1001, {locale: 'en'}), '1 kB');
	t.is(prettyBytes(1001n, {locale: 'en'}), '1 kB');
	t.is(prettyBytes(10.1, {locale: 'en'}), '10.1 B');
	t.is(prettyBytes(1e30, {locale: 'en'}), '1,000,000 YB');
	t.is(prettyBytes(10n ** 30n, {locale: 'en'}), '1,000,000 YB');
	t.is(prettyBytes(827_181 * 1e26, {locale: 'en'}), '82,718,100 YB');

	t.is(prettyBytes(-0.4, {locale: ['unknown', 'de', 'en']}), '-0,4 B');
	t.is(prettyBytes(0.4, {locale: ['unknown', 'de', 'en']}), '0,4 B');
	t.is(prettyBytes(1001, {locale: ['unknown', 'de', 'en']}), '1 kB');
	t.is(prettyBytes(1001n, {locale: ['unknown', 'de', 'en']}), '1 kB');
	t.is(prettyBytes(10.1, {locale: ['unknown', 'de', 'en']}), '10,1 B');
	t.is(prettyBytes(1e30, {locale: ['unknown', 'de', 'en']}), '1.000.000 YB');
	t.is(prettyBytes(10n ** 30n, {locale: ['unknown', 'de', 'en']}), '1.000.000 YB');
	t.is(prettyBytes(827_181 * 1e26, {locale: ['unknown', 'de', 'en']}), '82.718.100 YB');

	// Leaving `locale` out, setting it to `false` and setting it to `undefined` all take the same branch.
	for (const options of [{}, {locale: false}, {locale: undefined}]) {
		t.is(prettyBytes(-0.4, options), '-0.4 B');
		t.is(prettyBytes(0.4, options), '0.4 B');
		t.is(prettyBytes(1001, options), '1 kB');
		t.is(prettyBytes(1001n, options), '1 kB');
		t.is(prettyBytes(10.1, options), '10.1 B');
		t.is(prettyBytes(1e30, options), '1000000 YB');
		t.is(prettyBytes(10n ** 30n, options), '1000000 YB');
		t.is(prettyBytes(827_181 * 1e26, options), '82718100 YB');
	}
});

test('locale option falls back through the list it was given', t => {
	// A tag that no engine recognizes expresses no preference, so it resolves to the system locale rather than to the plain default.
	t.is(prettyBytes(1337, {locale: 'not-a-locale'}), prettyBytes(1337, {locale: true}));

	// A list is taken in order, and the first tag that resolves wins.
	t.is(prettyBytes(1337, {locale: ['bogus', 'de']}), '1,34 kB');
	t.is(prettyBytes(1337, {locale: ['de', 'bogus']}), '1,34 kB');
	t.is(prettyBytes(1337, {locale: ['bogus', 'de', 'en']}), '1,34 kB');

	// An empty string names a language nothing can resolve, so it is rejected rather than skipped.
	t.throws(() => {
		prettyBytes(1337, {locale: ''});
	}, {instanceOf: RangeError});

	t.throws(() => {
		prettyBytes(1337, {locale: ['bogus', 'also-bogus']});
	}, {instanceOf: RangeError});

	// An empty list expresses no preference at all, which is the system locale as well.
	t.is(prettyBytes(1234.5678, {locale: []}), prettyBytes(1234.5678, {locale: true}));
	t.is(prettyBytes(1234.5678, {locale: 'de'}), '1,23 kB');
});

test('a locale can change the digits without changing the unit', t => {
	// The unit title stays ASCII in every locale, which is what the documentation promises.
	t.is(prettyBytes(1337, {locale: 'ar-EG'}), '١٫٣٤ kB');
	t.is(prettyBytes(1337, {locale: 'de-DE-u-nu-arab'}), '١٫٣٤ kB');
	t.is(prettyBytes(1337, {locale: 'en-US-u-nu-deva'}), '१.३४ kB');
	t.is(prettyBytes(1e30, {locale: 'de-DE-u-nu-arab'}), '١٬٠٠٠٬٠٠٠ YB');

	// `fixedWidth` counts UTF-16 code units, and each of these digits is one of them.
	t.is(prettyBytes(1337, {locale: 'de-DE-u-nu-arab', fixedWidth: 8}), ' ١٫٣٤ kB');
	t.is(prettyBytes(1337, {locale: 'de-DE-u-nu-arab', fixedWidth: 10}), '   ١٫٣٤ kB');

	// A negative sign is ASCII even where the digits are not.
	t.is(prettyBytes(-1337, {locale: 'de-DE-u-nu-arab'}), '-١٫٣٤ kB');
});

test('locale option keeps the default significant digits', t => {
	// `Intl.NumberFormat` defaults to 3 *fraction* digits, which silently turned every value below 0.0005 into `0 B`. Values below `1e-6` are covered by their own test.
	t.is(prettyBytes(0.0001, {locale: 'en'}), '0.0001 B');
	t.is(prettyBytes(0.000_01, {locale: 'en'}), '0.00001 B');
	t.is(prettyBytes(0.000_001, {locale: 'en'}), '0.000001 B');
	t.is(prettyBytes(-0.0001, {locale: 'en'}), '-0.0001 B');
	t.is(prettyBytes(0.0001, {locale: 'de'}), '0,0001 B');
	t.is(prettyBytes(0.000_01, {locale: 'de'}), '0,00001 B');
	t.is(prettyBytes(0.000_01, {locale: ['unknown', 'de', 'en']}), '0,00001 B');

	// Rounding must match the non-localized path, which rounds to 3 significant digits.
	t.is(prettyBytes(0.0005, {locale: 'en'}), '0.0005 B');
	t.is(prettyBytes(0.0005), '0.0005 B');
	t.is(prettyBytes(0.123_456, {locale: 'en'}), '0.123 B');
	t.is(prettyBytes(0.123_456), '0.123 B');
	t.is(prettyBytes(12.3456, {locale: 'en'}), '12.3 B');
	t.is(prettyBytes(123_456, {locale: 'en'}), '123 kB');
	t.is(prettyBytes(123_456), '123 kB');
	t.is(prettyBytes(1_234_567, {locale: 'en'}), '1.23 MB');
	t.is(prettyBytes(1_234_567), '1.23 MB');
	t.is(prettyBytes(12_345_678, {locale: 'de'}), '12,3 MB');

	// Grouping is unaffected.
	t.is(prettyBytes(1e30, {locale: 'en'}), '1,000,000 YB');
	t.is(prettyBytes(1e30, {locale: 'de'}), '1.000.000 YB');
});

test('signed option', t => {
	t.is(prettyBytes(42, {signed: true}), '+42 B');
	t.is(prettyBytes(42n, {signed: true}), '+42 B');
	t.is(prettyBytes(-13, {signed: true}), '-13 B');
	t.is(prettyBytes(-13n, {signed: true}), '-13 B');
	t.is(prettyBytes(0, {signed: true}), ' 0 B');
	t.is(prettyBytes(0n, {signed: true}), ' 0 B');
	// A `bigint` has no negative zero, so `-0n` is the same value as `0n`. A `number` does.
	t.is(prettyBytes(-0, {signed: true}), ' 0 B');
});

test('signed zero is formatted like any other value', t => {
	// The zero shortcut used to hardcode `0`, which dropped the locale and the fraction digits.
	t.is(prettyBytes(0, {signed: true, minimumFractionDigits: 2}), ' 0.00 B');
	t.is(prettyBytes(0n, {signed: true, minimumFractionDigits: 2}), ' 0.00 B');
	t.is(prettyBytes(0, {signed: true, minimumFractionDigits: 1, maximumFractionDigits: 3}), ' 0.0 B');
	t.is(prettyBytes(0, {signed: true, maximumFractionDigits: 2}), ' 0 B');
	t.is(prettyBytes(0, {signed: true, locale: 'de'}), ' 0 B');
	t.is(prettyBytes(0, {signed: true, locale: 'ar-EG'}), ' ٠ B');
	// The natural output is 4 characters wide, so 2 more spaces are added.
	t.is(prettyBytes(0n, {signed: true, locale: 'ar-EG', fixedWidth: 6}), '   ٠ B');
	t.is(prettyBytes(0, {signed: true, bits: true}), ' 0 b');
	t.is(prettyBytes(0, {signed: true, binary: true}), ' 0 B');

	// `-0` must never reach the formatter, which prints it as `-0`.
	t.is(prettyBytes(-0), '0 B');
	t.is(prettyBytes(-0, {minimumFractionDigits: 2}), '0.00 B');
	t.is(prettyBytes(-0, {locale: 'de', maximumFractionDigits: 2}), '0 B');
	t.is(prettyBytes(-0, {signed: true, minimumFractionDigits: 2}), ' 0.00 B');
});

test('bits option', t => {
	t.is(prettyBytes(0, {bits: true}), '0 b');
	t.is(prettyBytes(0n, {bits: true}), '0 b');
	t.is(prettyBytes(0.4, {bits: true}), '0.4 b');
	t.is(prettyBytes(0.7, {bits: true}), '0.7 b');
	t.is(prettyBytes(10, {bits: true}), '10 b');
	t.is(prettyBytes(10n, {bits: true}), '10 b');
	t.is(prettyBytes(10.1, {bits: true}), '10.1 b');
	t.is(prettyBytes(999, {bits: true}), '999 b');
	t.is(prettyBytes(999n, {bits: true}), '999 b');
	t.is(prettyBytes(1001, {bits: true}), '1 kbit');
	t.is(prettyBytes(1001n, {bits: true}), '1 kbit');
	t.is(prettyBytes(1e16, {bits: true}), '10 Pbit');
	t.is(prettyBytes(10n ** 16n, {bits: true}), '10 Pbit');
	t.is(prettyBytes(1e30, {bits: true}), '1000000 Ybit');
	t.is(prettyBytes(10n ** 30n, {bits: true}), '1000000 Ybit');
	t.is(prettyBytes(827_181 * 1e26, {bits: true}), '82718100 Ybit');
});

test('binary option', t => {
	t.is(prettyBytes(0, {binary: true}), '0 B');
	t.is(prettyBytes(0n, {binary: true}), '0 B');
	t.is(prettyBytes(4, {binary: true}), '4 B');
	t.is(prettyBytes(4n, {binary: true}), '4 B');
	t.is(prettyBytes(10, {binary: true}), '10 B');
	t.is(prettyBytes(10n, {binary: true}), '10 B');
	t.is(prettyBytes(10.1, {binary: true}), '10.1 B');
	t.is(prettyBytes(999, {binary: true}), '999 B');
	t.is(prettyBytes(999n, {binary: true}), '999 B');
	t.is(prettyBytes(1025, {binary: true}), '1 KiB');
	t.is(prettyBytes(1025n, {binary: true}), '1 KiB');
	t.is(prettyBytes(1001, {binary: true}), '1001 B');
	t.is(prettyBytes(1001n, {binary: true}), '1001 B');
	t.is(prettyBytes(1e16, {binary: true}), '8.88 PiB');
	t.is(prettyBytes(10n ** 16n, {binary: true}), '8.88 PiB');
	t.is(prettyBytes(1e30, {binary: true}), '827181 YiB');
	t.is(prettyBytes(10n ** 30n, {binary: true}), '827181 YiB');
});

test('bits and binary option', t => {
	t.is(prettyBytes(0, {bits: true, binary: true}), '0 b');
	t.is(prettyBytes(0n, {bits: true, binary: true}), '0 b');
	t.is(prettyBytes(4, {bits: true, binary: true}), '4 b');
	t.is(prettyBytes(4n, {bits: true, binary: true}), '4 b');
	t.is(prettyBytes(10, {bits: true, binary: true}), '10 b');
	t.is(prettyBytes(10n, {bits: true, binary: true}), '10 b');
	t.is(prettyBytes(999, {bits: true, binary: true}), '999 b');
	t.is(prettyBytes(999n, {bits: true, binary: true}), '999 b');
	t.is(prettyBytes(1025, {bits: true, binary: true}), '1 kibit');
	t.is(prettyBytes(1025n, {bits: true, binary: true}), '1 kibit');
	t.is(prettyBytes(1e6, {bits: true, binary: true}), '977 kibit');
	t.is(prettyBytes(10n ** 6n, {bits: true, binary: true}), '977 kibit');
	t.is(prettyBytes(1e30, {bits: true, binary: true}), '827181 Yibit');
	t.is(prettyBytes(10n ** 30n, {bits: true, binary: true}), '827181 Yibit');
});

test('fractional digits options', t => {
	t.is(prettyBytes(1e30, {maximumFractionDigits: 1}), '1000000 YB');
	t.is(prettyBytes(10n ** 30n, {locale: false, maximumFractionDigits: 1}), '1000000 YB');
	t.is(prettyBytes(1900, {maximumFractionDigits: 1}), '1.9 kB');
	t.is(prettyBytes(1900n, {maximumFractionDigits: 1}), '1.9 kB');
	t.is(prettyBytes(1900, {minimumFractionDigits: 3}), '1.900 kB');
	t.is(prettyBytes(1900n, {minimumFractionDigits: 3}), '1.900 kB');
	t.is(prettyBytes(1911, {maximumFractionDigits: 1}), '1.9 kB');
	t.is(prettyBytes(1911n, {maximumFractionDigits: 1}), '1.9 kB');
	t.is(prettyBytes(1111, {maximumFractionDigits: 2}), '1.11 kB');
	t.is(prettyBytes(1111n, {maximumFractionDigits: 2}), '1.11 kB');
	t.is(prettyBytes(1019, {maximumFractionDigits: 3}), '1.019 kB');
	t.is(prettyBytes(1019n, {maximumFractionDigits: 3}), '1.019 kB');
	t.is(prettyBytes(1001, {maximumFractionDigits: 3}), '1.001 kB');
	t.is(prettyBytes(1001n, {maximumFractionDigits: 3}), '1.001 kB');
	t.is(prettyBytes(1000, {minimumFractionDigits: 1, maximumFractionDigits: 3}), '1.0 kB');
	t.is(prettyBytes(1000n, {minimumFractionDigits: 1, maximumFractionDigits: 3}), '1.0 kB');
	t.is(prettyBytes(3942, {minimumFractionDigits: 1, maximumFractionDigits: 2}), '3.94 kB');
	t.is(prettyBytes(3942n, {minimumFractionDigits: 1, maximumFractionDigits: 2}), '3.94 kB');
	t.is(prettyBytes(59_952_784, {maximumFractionDigits: 1}), '59.9 MB');
	t.is(prettyBytes(59_952_784n, {maximumFractionDigits: 1}), '59.9 MB');
	t.is(prettyBytes(59_952_784, {minimumFractionDigits: 1, maximumFractionDigits: 1}), '59.9 MB');
	t.is(prettyBytes(59_952_784n, {minimumFractionDigits: 1, maximumFractionDigits: 1}), '59.9 MB');
	t.is(prettyBytes(4001, {maximumFractionDigits: 3, binary: true}), '3.907 KiB');
	t.is(prettyBytes(4001n, {maximumFractionDigits: 3, binary: true}), '3.907 KiB');
	t.is(prettyBytes(18_717, {maximumFractionDigits: 2, binary: true}), '18.27 KiB');
	t.is(prettyBytes(18_717n, {maximumFractionDigits: 2, binary: true}), '18.27 KiB');
	t.is(prettyBytes(18_717, {maximumFractionDigits: 4, binary: true}), '18.2783 KiB');
	t.is(prettyBytes(18_717n, {maximumFractionDigits: 4, binary: true}), '18.2783 KiB');
	t.is(prettyBytes(32_768, {minimumFractionDigits: 2, maximumFractionDigits: 3, binary: true}), '32.00 KiB');
	t.is(prettyBytes(32_768n, {minimumFractionDigits: 2, maximumFractionDigits: 3, binary: true}), '32.00 KiB');
	t.is(prettyBytes(65_536, {minimumFractionDigits: 1, maximumFractionDigits: 3, binary: true}), '64.0 KiB');
	t.is(prettyBytes(65_536n, {minimumFractionDigits: 1, maximumFractionDigits: 3, binary: true}), '64.0 KiB');
});

testWithLocaleOverride('fractional digits options do not localize without a locale', async t => {
	const formattingScript = `
		import prettyBytes from './index.js';
		console.log(new Intl.NumberFormat().resolvedOptions().locale);
		console.log(prettyBytes(1337, {maximumFractionDigits: 2}));
		console.log(prettyBytes(1337n, {locale: false, maximumFractionDigits: 2}));
	`;
	const {stdout} = await execFileAsync(process.execPath, [
		'--input-type=module',
		'--eval',
		formattingScript,
	], {
		env: {
			...process.env,
			LC_ALL: 'de_DE.UTF-8',
		},
	});

	t.is(stdout, 'de-DE\n1.33 kB\n1.33 kB\n');
});

test('space option', t => {
	t.is(prettyBytes(0), '0 B');
	t.is(prettyBytes(0n), '0 B');
	t.is(prettyBytes(0, {space: false}), '0B');
	t.is(prettyBytes(0n, {space: false}), '0B');
	t.is(prettyBytes(999), '999 B');
	t.is(prettyBytes(999n), '999 B');
	t.is(prettyBytes(999, {space: false}), '999B');
	t.is(prettyBytes(999n, {space: false}), '999B');
	t.is(prettyBytes(-13, {signed: true}), '-13 B');
	t.is(prettyBytes(-13n, {signed: true}), '-13 B');
	t.is(prettyBytes(-13, {signed: true, space: false}), '-13B');
	t.is(prettyBytes(-13n, {signed: true, space: false}), '-13B');
	t.is(prettyBytes(42, {signed: true}), '+42 B');
	t.is(prettyBytes(42n, {signed: true}), '+42 B');
	t.is(prettyBytes(42, {signed: true, space: false}), '+42B');
	t.is(prettyBytes(42n, {signed: true, space: false}), '+42B');
});

test('nonBreakingSpace option', t => {
	// Basic non-breaking space functionality
	t.is(prettyBytes(1337, {nonBreakingSpace: true}), '1.34\u00A0kB');
	t.is(prettyBytes(1337n, {nonBreakingSpace: true}), '1.34\u00A0kB');

	// When space: false, nonBreakingSpace should be ignored
	t.is(prettyBytes(1337, {space: false, nonBreakingSpace: true}), '1.34kB');
	t.is(prettyBytes(1337n, {space: false, nonBreakingSpace: true}), '1.34kB');

	// Test with signed option (special case with leading space for zero)
	t.is(prettyBytes(0, {signed: true, nonBreakingSpace: true}), ' 0\u00A0B');
	t.is(prettyBytes(0n, {signed: true, nonBreakingSpace: true}), ' 0\u00A0B');
});

test('fixedWidth option', t => {
	// Basic fixed width functionality
	t.is(prettyBytes(1, {fixedWidth: 7}), '    1 B');
	t.is(prettyBytes(100, {fixedWidth: 7}), '  100 B');
	t.is(prettyBytes(1000, {fixedWidth: 7}), '   1 kB');
	t.is(prettyBytes(100_000, {fixedWidth: 7}), ' 100 kB');
	t.is(prettyBytes(1_000_000, {fixedWidth: 7}), '   1 MB');

	// With bigint (representative cases only)
	t.is(prettyBytes(1n, {fixedWidth: 7}), '    1 B');
	t.is(prettyBytes(1_000_000n, {fixedWidth: 7}), '   1 MB');

	// Different width
	t.is(prettyBytes(1337, {fixedWidth: 10}), '   1.34 kB');

	// With binary option
	t.is(prettyBytes(1024, {fixedWidth: 8, binary: true}), '   1 KiB');
	t.is(prettyBytes(10_240, {fixedWidth: 8, binary: true}), '  10 KiB');

	// With signed option
	t.is(prettyBytes(42, {fixedWidth: 8, signed: true}), '   +42 B');
	t.is(prettyBytes(-13, {fixedWidth: 8, signed: true}), '   -13 B');
	t.is(prettyBytes(0, {fixedWidth: 8, signed: true}), '     0 B');

	// When output is wider than fixedWidth, no padding is applied
	t.is(prettyBytes(1_000_000_000_000, {fixedWidth: 3}), '1 TB');

	// With locale
	t.is(prettyBytes(1337, {fixedWidth: 8, locale: 'de'}), ' 1,34 kB');

	// With bits option
	t.is(prettyBytes(1337, {fixedWidth: 10, bits: true}), ' 1.34 kbit');

	// FixedWidth: undefined (default) should not add padding
	t.is(prettyBytes(1337, {fixedWidth: undefined}), '1.34 kB');
	t.is(prettyBytes(1337, {}), '1.34 kB'); // Default behavior

	// With no space
	t.is(prettyBytes(1337, {fixedWidth: 7, space: false}), ' 1.34kB');

	// Edge cases
	t.is(prettyBytes(1337, {fixedWidth: 0}), '1.34 kB'); // No padding for 0 width

	// Invalid fixedWidth values should throw
	t.throws(() => prettyBytes(1337, {fixedWidth: -5}), {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got number: -5',
	});
	t.throws(() => prettyBytes(1337, {fixedWidth: Number.POSITIVE_INFINITY}), {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got number: Infinity',
	});
	t.throws(() => prettyBytes(1337, {fixedWidth: Number.NaN}), {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got number: NaN',
	});
	t.throws(() => prettyBytes(1337, {fixedWidth: 3.5}), {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got number: 3.5',
	});
	t.throws(() => prettyBytes(1337, {fixedWidth: '10'}), {
		instanceOf: TypeError,
		message: 'Expected fixedWidth to be a non-negative integer, got string: 10',
	});
	t.throws(() => prettyBytes(1337, {fixedWidth: Number.MAX_SAFE_INTEGER + 1}), {
		instanceOf: TypeError,
		message: `Expected fixedWidth to be a non-negative integer, got number: ${Number.MAX_SAFE_INTEGER + 1}`,
	});

	// With fractional digits
	t.is(prettyBytes(1500, {fixedWidth: 10, maximumFractionDigits: 1}), '    1.5 kB');

	// With small numbers
	t.is(prettyBytes(0.5, {fixedWidth: 8}), '   0.5 B');

	// With negative numbers (non-signed)
	t.is(prettyBytes(-1337, {fixedWidth: 8}), '-1.34 kB');

	// With non-breaking space
	t.is(prettyBytes(1337, {fixedWidth: 8, nonBreakingSpace: true}), ' 1.34\u00A0kB');
});

test('documented examples are accurate', t => {
	for (const fileName of ['readme.md', 'index.d.ts']) {
		const {blocks, examples} = documentedExamples(new URL(fileName, import.meta.url));
		const markers = documentedMarkers(blocks);

		t.is(examples.length, markers, `${fileName}: only ${examples.length} of ${markers} documented examples were found`);

		for (const block of blocks) {
			if (/\bprettyBytes\s*\(/.test(block)) {
				t.regex(block, /\/\/\s*=>/, `${fileName}: a fence that calls prettyBytes has no //=> example`);
			}
		}

		for (const [code, expected] of examples) {
			// eslint-disable-next-line no-new-func
			const evaluate = new Function('prettyBytes', `return (${code.replaceAll(/;$/gm, '')});`);
			t.deepEqual(evaluate(prettyBytes), JSON.parse(expected.replaceAll('\'', '"')), `${fileName}: ${code.trim()}`);
		}
	}
});

// `locale: true` follows the system locale, so the expectations below only hold for en-US.
// Nothing but `locale: true` may depend on the system locale, so the output has to be identical everywhere.
const systemLocales = ['de_DE.UTF-8', 'ja_JP.UTF-8', 'ar_EG.UTF-8', 'fa_IR.UTF-8'];

testWithLocaleOverride('the output does not depend on the system locale', async t => {
	const formattingScript = `
		import prettyBytes from './index.js';
		const values = [0, 1, 999, 1000, 1024, 1337, 1e6, 1.5e9, 1e30, 0.4, 1e-7, 0.0001, 1805, 1125];
		const optionSets = [{}, {binary: true}, {bits: true}, {bits: true, binary: true}, {signed: true}, {space: false}, {nonBreakingSpace: true}, {locale: false}, {minimumFractionDigits: 2}, {maximumFractionDigits: 1}, {minimumFractionDigits: 1, maximumFractionDigits: 3}, {fixedWidth: 14}];
		for (const options of optionSets) {
			for (const value of values) {
				console.log(prettyBytes(value, options));
			}
		}
	`;

	const runIn = async locale => {
		const {stdout} = await execFileAsync(process.execPath, [
			'--input-type=module',
			'--eval',
			formattingScript,
		], {
			env: {
				...process.env,
				LC_ALL: locale,
				LANG: locale,
			},
		});

		return stdout;
	};

	const reference = await runIn('en_US.UTF-8');

	// Collected first, because awaiting inside a loop is not allowed.
	const outputs = await Promise.all(systemLocales.map(locale => runIn(locale)));
	for (const [index, output] of outputs.entries()) {
		t.is(output, reference, `the output differs under ${systemLocales[index]}`);
	}
});

testWithLocaleOverride('locale: true uses the system locale', async t => {
	const formattingScript = `
		import prettyBytes from './index.js';
		console.log(prettyBytes(-0.4, {locale: true}));
		console.log(prettyBytes(0.4, {locale: true}));
		console.log(prettyBytes(1001, {locale: true}));
		console.log(prettyBytes(1001n, {locale: true}));
		console.log(prettyBytes(10.1, {locale: true}));
		console.log(prettyBytes(1e30, {locale: true}));
		console.log(prettyBytes(10n ** 30n, {locale: true}));
		console.log(prettyBytes(827_181 * 1e26, {locale: true}));
	`;
	const {stdout} = await execFileAsync(process.execPath, [
		'--input-type=module',
		'--eval',
		formattingScript,
	], {
		env: {
			...process.env,
			LC_ALL: 'en_US.UTF-8',
		},
	});

	t.is(stdout, [
		'-0.4 B',
		'0.4 B',
		'1 kB',
		'1 kB',
		'10.1 B',
		'1,000,000 YB',
		'1,000,000 YB',
		'82,718,100 YB',
	].join('\n') + '\n');
});

testWithLocaleOverride('locale: true uses the 3 significant digit default', async t => {
	const formattingScript = `
		import prettyBytes from './index.js';
		console.log(prettyBytes(0.0001, {locale: true}));
		console.log(prettyBytes(0.0005, {locale: true}));
		console.log(prettyBytes(1e30, {locale: true}));
		console.log(prettyBytes(1_234_567, {locale: true}));
	`;
	const {stdout} = await execFileAsync(process.execPath, [
		'--input-type=module',
		'--eval',
		formattingScript,
	], {
		env: {
			...process.env,
			LC_ALL: 'de_DE.UTF-8',
		},
	});

	t.is(stdout, '0,0001 B\n0,0005 B\n1.000.000 YB\n1,23 MB\n');
});

/*
`floor(a / b) + (a % b) / b` is a different double than `a / b`, which used to flip the 3 significant digit rounding at exact ties. The mantissas sit on and around every such tie.
*/
const ROUNDING_TIES = [1005, 1015, 1125, 1235, 1245, 1265, 1485, 1695, 1715, 1765, 1795, 1805, 1815, 1835, 1855, 2005, 2125, 4565];
const FORMATTINGS = [{}, {binary: true}, {bits: true}, {bits: true, binary: true}, {signed: true}, {locale: 'de'}];

test('a bigint formats like the equivalent number', t => {
	const mantissas = [1, 3, 7, 99, 100, 101, 512, 999, 1001, 1023, 1024, 1025, 99_999, 100_001, 123_456_789, ...ROUNDING_TIES];

	for (let exponent = 0; exponent <= 15; exponent++) {
		for (const scale of [10 ** exponent, 2 ** exponent]) {
			for (const mantissa of mantissas) {
				const value = mantissa * scale;
				if (!Number.isSafeInteger(value)) {
					continue;
				}

				for (const options of FORMATTINGS) {
					t.is(prettyBytes(BigInt(value), options), prettyBytes(value, options), `${value} formats differently as a bigint`);
				}
			}
		}
	}
});

test('rounding follows Number#toPrecision at exact ties', t => {
	// `1.005` is stored just below the tie and `1.125` exactly on it, so the two round in opposite directions.
	for (const [value, expected] of [[1005, '1 kB'], [1125, '1.13 kB'], [1235, '1.24 kB'], [1265, '1.26 kB'], [1695, '1.7 kB'], [1805, '1.8 kB'], [2005, '2 kB']]) {
		t.is(prettyBytes(value), expected);
		t.is(prettyBytes(BigInt(value)), expected);
	}

	// A scaled value can only land exactly on a tie when it is dyadic, so the binary ties are exact and always round up.
	for (const [value, expected] of [[1152, '1.13 KiB'], [1280, '1.25 KiB'], [1536, '1.5 KiB']]) {
		t.is(prettyBytes(value, {binary: true}), expected);
		t.is(prettyBytes(BigInt(value), {binary: true}), expected);
	}

	// Just over a whole number of kibibytes, which rounds back down to it.
	t.is(prettyBytes(1025, {binary: true}), '1 KiB');
	t.is(prettyBytes(1025n, {binary: true}), '1 KiB');

	// The largest and smallest `bigint` that a `number` can hold exactly still take the same path as a `number`.
	for (const value of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MIN_SAFE_INTEGER, 0, 1]) {
		t.is(prettyBytes(BigInt(value)), prettyBytes(value), `${value} formats differently as a bigint`);
	}
});

test('a bigint scales exactly in the largest unit', t => {
	// Every whole number of yottabytes comes out exact. Yottabytes is also the only unit whose divisor is inexact, because `1000 ** 8` is not `1e24` as a `number` while every power of 1024 is.
	for (let mantissa = 1; mantissa <= 999; mantissa++) {
		t.is(prettyBytes(BigInt(mantissa) * (10n ** 24n)), `${mantissa} YB`);
	}

	// The exact quotient here is 1.005, which is stored just below the tie, so it rounds down to 1 rather than up to 1.01. Dividing by the inexact divisor used to push it over.
	t.is(prettyBytes(1_005_000_000_000_000_000_000_000n), '1 YB');
	t.is(prettyBytes(1.005e24), '1 YB');
});

test('large bigints scale exactly', t => {
	// 1e44 bytes is exactly 1e20 yottabytes. Dividing it as a `number` goes through `1000 ** 8`, which is not exactly representable, and comes out as 100000000000000020000 instead.
	t.is(prettyBytes(10n ** 44n), '100000000000000000000 YB');
	t.is(prettyBytes(10n ** 45n), '1000000000000000000000 YB');
	t.is(prettyBytes(-(10n ** 44n)), '-100000000000000000000 YB');

	// 2^80 bytes is 1.208925819614629174706176 yottabytes.
	t.is(prettyBytes(2n ** 80n), '1.21 YB');

	// 2^90 bytes is 1237.94 yottabytes, and yottabytes is the largest unit, so it stays there.
	t.is(prettyBytes(2n ** 90n), '1238 YB');

	// 2^100 bytes is exactly 1048576 yobibytes.
	t.is(prettyBytes(2n ** 100n, {binary: true}), '1048576 YiB');
	t.is(prettyBytes(12_345_678_901_234_567_890_123n), '12.3 ZB');
});

test('a locale does not change the digits', t => {
	for (const options of [{}, {binary: true}, {bits: true}, {bits: true, binary: true}]) {
		for (let exponent = -7; exponent <= 21; exponent++) {
			for (const mantissa of [1, 1.5, 3, 7.5, 99.5, 999.5, 512.5, 1023.5, 0.4, 0.75, 0.123_456]) {
				const value = mantissa * (10 ** exponent);
				t.is(digitsOf(prettyBytes(value, {...options, locale: 'en'})), digitsOf(prettyBytes(value, options)));
			}
		}
	}
});

test('the formatted value never shrinks as the input grows', t => {
	const impliedBytes = (output, base, units) => {
		const [, sign, number, unit] = /^([-+]?)(\d+(?:\.\d+)?) ?(\S+)$/.exec(output);
		return (sign === '-' ? -1 : 1) * Number(number) * (base ** units.indexOf(unit));
	};

	for (const [base, units] of [[1000, DECIMAL_UNITS], [1024, BINARY_UNITS]]) {
		const values = [];
		const edges = [1, base / 4, base / 2, (3 * base) / 4, base - 1];

		for (let exponent = 0; exponent < units.length; exponent++) {
			for (const edge of edges) {
				for (const delta of [-1, -0.5, 0, 0.5, 1]) {
					values.push((edge * (base ** exponent)) + delta);
				}
			}
		}

		values.sort((a, b) => a - b);

		const options = base === 1024 ? {binary: true} : {};
		let previous;
		for (const value of values) {
			const implied = impliedBytes(prettyBytes(value, options), base, units);
			t.true(previous === undefined || implied >= previous, `${value} formatted below the previous value`);
			previous = implied;
		}
	}
});

// TODO: Unskip when targeting Node.js 22. Node.js 20 only accepts up to 20 fraction digits in `Intl.NumberFormat`.
// eslint-disable-next-line ava/no-skip-test
test.skip('the output is always plain decimal that is within half a percent', t => {
	const values = [];
	for (let exponent = -25; exponent <= 60; exponent++) {
		for (const mantissa of [1, 1.5, 3, 7.5, 99.5, 999.5, 1023.5, 1.234_567]) {
			values.push(mantissa * (10 ** exponent));
		}
	}

	for (const [options, base, units] of [
		[{}, 1000, DECIMAL_UNITS],
		[{binary: true}, 1024, BINARY_UNITS],
		[{bits: true}, 1000, BIT_UNITS],
		[{bits: true, binary: true}, 1024, BIBIT_UNITS],
		[{signed: true}, 1000, DECIMAL_UNITS],
		[{locale: 'en'}, 1000, DECIMAL_UNITS],
	]) {
		for (const value of values) {
			const output = prettyBytes(value, options);
			const [number, unit] = output.split(' ');
			t.notRegex(number, /e/i, `${value} formatted with exponential notation: ${output}`);
			t.true(units.includes(unit), `${value} formatted with an unknown unit: ${output}`);

			// Rounding to 3 significant digits is at most 0.5% off.
			const implied = Number(number.replaceAll(',', '')) * (base ** units.indexOf(unit));
			const relativeError = Math.abs(implied - value) / Math.abs(value);
			t.true(relativeError < 0.005, `${value} formatted as ${output}, which is ${(relativeError * 100).toFixed(2)}% off`);
		}
	}
});

// TODO: Unskip when targeting Node.js 22. Node.js 20 only accepts up to 20 fraction digits in `Intl.NumberFormat`.
// eslint-disable-next-line ava/no-skip-test
test.skip('values below 1e-6 keep their digits', t => {
	// Rounding to 3 significant digits leaves a lot of fraction digits, which `Intl.NumberFormat` is told about so it keeps them all.
	for (const options of [{}, {locale: 'en'}, {locale: 'de'}, {binary: true}, {bits: true}]) {
		t.is(digitsOf(prettyBytes(0.000_000_1, options)), digitsOf('0.0000001 B'));
		t.is(digitsOf(prettyBytes(0.000_000_123_4, options)), digitsOf('0.000000123 B'));
	}

	// The decimal separator is localized like for any other value.
	t.is(prettyBytes(0.000_000_1, {locale: 'de'}), '0,0000001 B');
	t.is(prettyBytes(0.000_000_1, {locale: 'ar-EG'}), '٠٫٠٠٠٠٠٠١ B');
	t.is(prettyBytes(0.000_000_123_4, {locale: 'de'}), '0,000000123 B');

	// Truncation to 3 fraction digits really does reach 0.
	t.is(prettyBytes(0.000_000_1, {locale: 'de', maximumFractionDigits: 3}), '0 B');
	t.is(prettyBytes(0.000_000_1, {maximumFractionDigits: 3}), '0 B');

	// Up to 100 fraction digits still fit what `Intl.NumberFormat` accepts, so they stay localized.
	for (const [value, fraction] of [[1e-99, '0'.repeat(98) + '1'], [1.5e-99, '0'.repeat(98) + '15'], [1e-100, '0'.repeat(99) + '1']]) {
		t.is(prettyBytes(value), `0.${fraction} B`);
		t.is(prettyBytes(value, {locale: 'de'}), `0,${fraction} B`);
		t.is(prettyBytes(value, {locale: 'en'}), `0.${fraction} B`);
	}

	// One digit more does not fit, so those values are written out plainly, which also means the decimal separator is no longer localized.
	const tooSmall = '0.' + '0'.repeat(199) + '1 B';
	t.is(prettyBytes(1e-200), tooSmall);
	t.is(prettyBytes(1e-200, {locale: 'en'}), tooSmall);
	t.is(prettyBytes(1e-200, {locale: 'de'}), tooSmall);
	t.is(prettyBytes(1e-200, {locale: 'ar-EG'}), tooSmall);
});

test('the extremes of the number range format as plain digits', t => {
	// `Number#toString` switches to exponential notation at both ends of the range, which is exactly where the plain digit fallback has to hold.
	for (const value of [Number.MAX_VALUE, Number.MIN_VALUE, 1e-323, Number.EPSILON, 1e-6, 9.99e-7, 1e21, 1e22]) {
		for (const options of [{}, {locale: 'en'}, {locale: 'de'}, {binary: true}]) {
			const [number] = prettyBytes(value, options).split(' ');
			t.notRegex(number, /e/i, `${value} formatted with exponential notation`);
		}
	}

	t.is(prettyBytes(Number.EPSILON), '0.000000000000000222 B');
	t.is(prettyBytes(Number.MIN_VALUE), `0.${'0'.repeat(323)}5 B`);
	t.is(prettyBytes(Number.MAX_VALUE), `17976931348623158${'0'.repeat(268)} YB`);
});

test('zero keeps its locale digits', t => {
	t.is(prettyBytes(0, {locale: 'ar-EG'}), '٠ B');
	t.is(prettyBytes(0n, {locale: 'ar-EG'}), '٠ B');
	t.is(prettyBytes(0, {locale: 'ar-EG', minimumFractionDigits: 2}), '٠٫٠٠ B');
	t.is(prettyBytes(0, {locale: 'de'}), '0 B');
	t.is(prettyBytes(0), '0 B');
	t.is(prettyBytes(0n), '0 B');
});

test('very large values keep plain digits with a locale', t => {
	// 1e45 bytes is 1e21 yottabytes, which is past the range `Intl.NumberFormat` writes as an exponent.
	t.is(prettyBytes(1e45, {locale: 'en'}), '1,000,000,000,000,000,000,000 YB');
	t.is(prettyBytes(1e45, {locale: 'de'}), '1.000.000.000.000.000.000.000 YB');
	t.is(prettyBytes(1e45), '1000000000000000000000 YB');
	t.is(prettyBytes(10n ** 46n, {locale: 'en'}), '10,000,000,000,000,000,000,000 YB');
	t.is(prettyBytes(10n ** 46n), '10000000000000000000000 YB');
});

test('bigints are accepted up to the number range', t => {
	// 1e332 bytes is the largest power of ten that still scales down to a finite number.
	t.is(prettyBytes(10n ** 332n), `1${'0'.repeat(308)} YB`);
	t.is(prettyBytes(10n ** 333n), `1${'0'.repeat(309)} YB`);
});

test('bigints too large for a number are written out in full', t => {
	// These used to throw, and before that formatted as `Infinity YB`, `∞ YB` or `+Infinity YB`. The scaled value is past what a `number` can hold, so it is written out from the exact quotient, keeping every integer digit.
	t.is(prettyBytes(10n ** 400n), `1${'0'.repeat(376)} YB`);
	t.is(prettyBytes(-(10n ** 400n)), `-1${'0'.repeat(376)} YB`);
	t.is(prettyBytes(10n ** 400n, {signed: true}), `+1${'0'.repeat(376)} YB`);
	t.is(prettyBytes(10n ** 400n, {space: false}), `1${'0'.repeat(376)}YB`);
	t.is(prettyBytes(10n ** 400n, {nonBreakingSpace: true}), `1${'0'.repeat(376)}\u00A0YB`);
	t.is(prettyBytes(10n ** 400n, {bits: true}), `1${'0'.repeat(376)} Ybit`);

	// Binary scales by 2^80 rather than 1e24, so the exact quotient is a long number rather than a power of ten, and every one of its digits is kept.
	t.is(prettyBytes(10n ** 400n, {binary: true}), `${(10n ** 400n) / (1024n ** 8n)} YiB`);

	// The fraction digit options still apply. The test below covers a nonzero fraction, which is truncated and trimmed exactly like everywhere else.
	t.is(prettyBytes(10n ** 400n, {minimumFractionDigits: 4}), `1${'0'.repeat(376)}.0000 YB`);
	t.is(prettyBytes(10n ** 400n, {maximumFractionDigits: 0}), `1${'0'.repeat(376)} YB`);

	// A remainder too small to reach the requested precision disappears rather than becoming zeros.
	t.is(prettyBytes((10n ** 400n) + 12_345n, {maximumFractionDigits: 2}), `1${'0'.repeat(376)} YB`);

	// `Intl.NumberFormat` is not involved past the number range, so the digits are plain there, as they already are for a value below `1e-100`.
	for (const options of [{locale: 'de'}, {locale: 'en'}, {locale: 'ar-EG'}]) {
		t.is(prettyBytes(10n ** 400n, options), `1${'0'.repeat(376)} YB`);
	}

	// The boundary is continuous: 1e332 bytes still fits a `number`, 1e333 does not, and each keeps every digit of its scaled value.
	for (let exponent = 330; exponent <= 334; exponent++) {
		t.is(prettyBytes(10n ** BigInt(exponent)), `1${'0'.repeat(exponent - 24)} YB`);
	}
});

test('a value past the number range is the exact quotient', t => {
	// Nothing is rounded away here, in either base, so the output is the quotient written out in full.
	for (const [base, units, options] of [[1000n, DECIMAL_UNITS, {}], [1024n, BINARY_UNITS, {binary: true}]]) {
		for (const bytes of [10n ** 333n, 10n ** 400n, 2n ** 1200n, 3n ** 800n, 2n ** 2000n]) {
			t.is(prettyBytes(bytes, options), `${bytes / (base ** 8n)} ${units[8]}`);
		}
	}
});

test('the value never shrinks across the switch to exact bigint arithmetic', t => {
	// The number path and the exact bigint path meet at 1e332 bytes, so the output must not step backwards there.
	const impliedBytes = bytes => {
		const [number, unit] = prettyBytes(bytes).split(' ');
		return BigInt(number) * (10n ** BigInt(DECIMAL_UNITS.indexOf(unit) * 3));
	};

	let previous = 0n;
	for (let exponent = 320; exponent <= 360; exponent++) {
		for (const delta of [0n, 1n, 12_345n, 10n ** 20n, 10n ** 23n, 10n ** 24n, 10n ** 25n]) {
			const bytes = (10n ** BigInt(exponent)) + delta;
			const current = impliedBytes(bytes);
			t.true(current >= previous, `${bytes} formatted below the previous value`);
			previous = current;
		}
	}
});

test('fraction digit options apply past the number range', t => {
	const scale = 10n ** 24n;
	const half = (5n * (10n ** 375n)) + (scale / 2n);
	const quarter = (5n * (10n ** 375n)) + (scale / 4n);

	// Trailing zeros are trimmed back to the minimum, exactly as `Intl.NumberFormat` does.
	t.is(prettyBytes(half, {maximumFractionDigits: 4}), `${half / scale}.5 YB`);
	t.is(prettyBytes(quarter, {maximumFractionDigits: 4}), `${quarter / scale}.25 YB`);

	// A minimum above the fraction pads it back out, and a maximum above it does not add digits of its own.
	t.is(prettyBytes(quarter, {minimumFractionDigits: 4}), `${quarter / scale}.2500 YB`);
	t.is(prettyBytes(half, {minimumFractionDigits: 2, maximumFractionDigits: 6}), `${half / scale}.50 YB`);

	// The divisor is a power of two in binary, so the fraction there is a different decimal.
	const binaryScale = 1024n ** 8n;
	const binaryQuarter = (5n * (10n ** 375n)) + (binaryScale / 4n);
	t.is(prettyBytes(binaryQuarter, {binary: true, maximumFractionDigits: 4}), `${binaryQuarter / binaryScale}.25 YiB`);

	// The sign is kept while all of that happens.
	t.true(prettyBytes(-half, {maximumFractionDigits: 3}).startsWith('-'));
	t.true(prettyBytes(-half, {maximumFractionDigits: 3}).endsWith('.5 YB'));
});

test('a value past the number range ignores grouping and padding', t => {
	// `Intl.NumberFormat` is skipped, and no padding is added because the result is already far wider than any width worth asking for. The separator is still chosen, though.
	const expected = `1${'0'.repeat(376)} YB`;
	t.is(prettyBytes(10n ** 400n, {locale: true}), expected);
	t.is(prettyBytes(10n ** 400n, {fixedWidth: 8}), expected);
	t.is(prettyBytes(10n ** 400n, {fixedWidth: 8, nonBreakingSpace: true}), `1${'0'.repeat(376)}\u00A0YB`);
	t.is(prettyBytes(10n ** 400n, {space: false, nonBreakingSpace: true}), `1${'0'.repeat(376)}YB`);
});

test('the options shape the output as documented', t => {
	const values = [0, 1, 512, 999, 1000, 1024, 1337, 1_048_576, 1e15];
	const positive = [...values, ...values.map(value => -value)];

	for (const value of positive) {
		const plain = prettyBytes(value);

		t.false(prettyBytes(value, {space: false}).includes(' '), 'space: false still emitted a space');
		t.false(prettyBytes(value, {nonBreakingSpace: true}).includes(' '), 'nonBreakingSpace still emitted a regular space');
		t.is(prettyBytes(value, {space: false, nonBreakingSpace: true}).replaceAll('\u00A0', ' '), prettyBytes(value, {space: false}));

		for (const width of [4, 8, 16]) {
			const padded = prettyBytes(value, {fixedWidth: width});
			if (plain.length <= width) {
				t.is(padded.length, width);
				t.is(padded.trimStart(), plain);
			} else {
				t.is(padded, plain);
			}
		}

		// A difference of exactly zero is padded with a space instead of a plus sign.
		const prefix = value === 0 ? ' ' : (value < 0 ? '-' : '+');
		t.is(prettyBytes(value, {signed: true}), prefix + prettyBytes(Math.abs(value)));
	}
});
