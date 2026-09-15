import { describe, expect, it } from 'vitest';
import { parseChatText, parseInline } from '@/lib/chat-format';

/**
 * The shopping assistant's replies arrive with Markdown the model was asked
 * not to use. Customers should see bold words and lists, never asterisks.
 */

describe('parseInline', () => {
  it('turns double asterisks into bold and single ones into italics', () => {
    expect(parseInline('The **Noor Nida Everyday Abaya** in *navy*')).toEqual([
      { text: 'The ' },
      { text: 'Noor Nida Everyday Abaya', bold: true },
      { text: ' in ' },
      { text: 'navy', italic: true },
    ]);
  });

  it('keeps plain text exactly as written', () => {
    expect(parseInline('Rs 6,900, stitched in 6 days.')).toEqual([
      { text: 'Rs 6,900, stitched in 6 days.' },
    ]);
  });

  it('reduces links and code to their words', () => {
    expect(parseInline('See [our returns policy](https://example.com) or `SALE10`')).toEqual([
      { text: 'See our returns policy or SALE10' },
    ]);
  });

  it('drops a bold marker left without its partner', () => {
    expect(parseInline('Made from **Korean Nida matte')).toEqual([
      { text: 'Made from Korean Nida matte' },
    ]);
  });

  it('does not treat a lone asterisk or multiplication as emphasis', () => {
    expect(parseInline('Sizes 2 * 3 and a note*')).toEqual([{ text: 'Sizes 2 * 3 and a note*' }]);
  });
});

describe('parseChatText', () => {
  it('renders the reply a customer actually saw with bold text and a list', () => {
    const reply = [
      'Here’s the **Noor Nida Everyday Abaya** in **navy** for **Rs 6,900**:',
      '',
      '- A simple, elegant abaya made from **Korean Nida matte fabric** (no shine).',
      '- Straight sleeves and a concealed front placket.',
      '- Made to measure, stitched in **6 days**.',
      '',
      'Would you like to order this one? 😊',
    ].join('\n');

    const blocks = parseChatText(reply);

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      parts: [
        { text: 'Here’s the ' },
        { text: 'Noor Nida Everyday Abaya', bold: true },
        { text: ' in ' },
        { text: 'navy', bold: true },
        { text: ' for ' },
        { text: 'Rs 6,900', bold: true },
        { text: ':' },
      ],
    });
    const list = blocks[1];
    expect(list.type === 'list' && list.ordered).toBe(false);
    expect(list.type === 'list' && list.items).toHaveLength(3);
    expect(JSON.stringify(blocks)).not.toContain('*');
  });

  it('recognises numbered lists and keeps them apart from bullets', () => {
    const blocks = parseChatText('1. Black\n2. Navy\n- Beige');
    expect(blocks).toEqual([
      { type: 'list', ordered: true, items: [[{ text: 'Black' }], [{ text: 'Navy' }]] },
      { type: 'list', ordered: false, items: [[{ text: 'Beige' }]] },
    ]);
  });

  it('keeps line breaks inside a paragraph and strips heading marks', () => {
    expect(parseChatText('## Delivery\nLahore: 2-3 days\nKarachi: 3-4 days')).toEqual([
      { type: 'paragraph', parts: [{ text: 'Delivery\nLahore: 2-3 days\nKarachi: 3-4 days' }] },
    ]);
  });
});
