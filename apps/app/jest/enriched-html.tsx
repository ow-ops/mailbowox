import { useImperativeHandle, useState, type Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { htmlToText, textToHtml } from '@/mail/rich';

type Change = (event: { nativeEvent: { value: string } }) => void;
type Props = Omit<TextInputProps, 'onChangeText'> & {
  ref?: Ref<unknown>;
  defaultValue?: string;
  htmlStyle?: unknown;
  onChangeText?: Change;
  onChangeHtml?: Change;
};

// The editor is native; tests type into a plain field that reports the same events.
export function EnrichedTextInput(props: Props) {
  const { ref, defaultValue = '', htmlStyle: _, onChangeText, onChangeHtml, ...field } = props;
  const [text, setText] = useState(() => htmlToText(defaultValue));
  const change = (next: string) => {
    setText(next);
    onChangeText?.({ nativeEvent: { value: next } });
    onChangeHtml?.({ nativeEvent: { value: textToHtml(next) } });
  };
  useImperativeHandle(ref, () => ({
    setValue: (html: string) => change(htmlToText(html)),
    setSelection: jest.fn(),
    focus: jest.fn(),
  }));
  return <TextInput {...field} value={text} onChangeText={change} />;
}
