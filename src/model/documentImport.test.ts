import { describe, expect, it } from 'vitest';

import { documentContent } from './documentImport';
import { blankPackage } from './editForms';
import { drivenToOrFrom, mergePackages } from './proposals';

describe('documentContent', () => {
  it('reads a saved email as its text, whatever type the browser gave it', async () => {
    const rtf = new File(['{\\rtf1 Pick-up Sep 24, 03:00 PM}'], 'rental.rtf', { type: '' });
    expect(await documentContent(rtf)).toEqual({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: '{\\rtf1 Pick-up Sep 24, 03:00 PM}' },
    });
  });

  it('sends a PDF as a document and a photo as an image', async () => {
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    const png = new File(['png'], 'a.png', { type: 'image/png' });
    const read = async (file: File) => `data:${file.type};base64,${file.name}-bytes`;
    expect(await documentContent(pdf, read)).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'a.pdf-bytes' },
    });
    expect(await documentContent(png, read)).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'a.png-bytes' },
    });
  });

  it('turns away a format it can’t read', async () => {
    const zip = new File(['zip'], 'a.zip', { type: 'application/zip' });
    await expect(documentContent(zip)).rejects.toThrow('Unsupported file type');
  });
});

describe('drivenToOrFrom', () => {
  const stay = { checkInAt: '2027-07-01T15:00', checkOutAt: '2027-07-03T11:00' };
  const drive = (departsAt: string, mode = 'drive') => ({ mode, departsAt, arrivesAt: null });

  it('is true when a drive leaves on check-in or check-out day', () => {
    expect(drivenToOrFrom(stay, [drive('2027-07-01T09:00')])).toBe(true);
    expect(drivenToOrFrom(stay, [drive('2027-07-03T12:00')])).toBe(true);
  });

  it('is false for a drive mid-stay, or a flight in', () => {
    expect(drivenToOrFrom(stay, [drive('2027-07-02T09:00')])).toBe(false);
    expect(drivenToOrFrom(stay, [drive('2027-07-01T09:00', 'flight')])).toBe(false);
  });
});

describe('mergePackages', () => {
  it('updates a package already there by name instead of adding a copy', () => {
    const fee = { ...blankPackage(), name: 'Resort fee', cost: { amount: 19, currency: 'USD' } };
    const merged = mergePackages(
      [fee],
      [{ ...fee, _id: 'other', cost: { amount: 20, currency: 'USD' } }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ _id: fee._id, cost: { amount: 20 } });
  });

  it('keeps how a restated price is paid, and whom a package covers', () => {
    const fee = { ...blankPackage(), name: 'Resort fee', cost: { amount: 19, currency: 'USD' } };
    const [merged] = mergePackages(
      [fee],
      [{ ...fee, payable: 'atProperty' as const, travelers: ['t1'] }],
    );
    expect(merged).toMatchObject({ payable: 'atProperty', travelers: ['t1'] });
  });

  it('clears whom a package covers when it is restated for the whole party', () => {
    const fee = { ...blankPackage(), name: 'Resort fee', travelers: ['t1'], benefits: ['Spa'] };
    const [merged] = mergePackages([fee], [{ ...fee, travelers: null, benefits: null }]);
    expect(merged).toMatchObject({ travelers: null, benefits: null });
    const [kept] = mergePackages([fee], [{ ...fee, travelers: undefined, benefits: undefined }]);
    expect(kept).toMatchObject({ travelers: ['t1'], benefits: ['Spa'] });
  });
});
