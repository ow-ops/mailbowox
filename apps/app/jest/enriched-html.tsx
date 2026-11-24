import { useImperativeHandle, useState, type Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { textToHtml } from '@/mail/rich';

type Change = (event: { nativeEvent: { value: string } }) => void;
type Props = TextInputProps & {
  ref?: Ref<unknown>;
  defaultValue?: string;
  htmlStyle?: unknown;
  onChangeHtml?: Change;
};

// What the core makes of the editor's HTML, near enough for these tests; the core tests its own.
export const plainText = (html: string) =>
  html
    .replace(/<br>|<\/p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trimEnd();

// The editor is native; tests type into a plain field that reports the same events.
export function EnrichedTextInput(props: Props) {
  const { ref, defaultValue = '', htmlStyle: _, onChangeHtml, ...field } = props;
  const [text, setText] = useState(() => plainText(defaultValue));
  const change = (next: string) => {
    setText(next);
    onChangeHtml?.({ nativeEvent: { value: textToHtml(next) } });
  };
  useImperativeHandle(ref, () => ({
    setValue: (html: string) => change(plainText(html)),
    setSelection: jest.fn(),
    focus: jest.fn(),
  }));
  return <TextInput {...field} value={text} onChangeText={change} />;
}
