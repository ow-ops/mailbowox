import { useMutation } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAccount, useAccounts } from '@/accounts/store';
import { AddressField, allRecipients, emptyRecipients } from '@/components/address-field';
import { Button } from '@/components/button';
import { SenderPicker } from '@/components/sender-picker';
import { ThemedText, textStyles } from '@/components/themed-text';
import type { Address, AttachmentInfo, Draft, DraftAttachment, OutgoingAttachment } from '@/core';
import { ColumnWidth, frameless, Hairline, Press, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useFileDrop } from '@/hooks/use-file-drop';
import { useTheme } from '@/hooks/use-theme';
import { isEmail } from '@/mail/address';
import { mailStore } from '@/mail/store';
import { explainError } from '@/core/errors';
import { senders, setLastFrom, type Sender } from '@/mail/from';
import { messageParams, type MessageRef } from '@/mail/refs';
import { fetchForwarded } from '@/mail/forward';
import { resign, sign, type Prefill, type ReplyMode } from '@/mail/reply';
import { handBack, readLocalDraft, removeLocalDraft, takeBack, writeLocalDraft, type LocalDraft } from '@/mail/local-drafts';
import { saveDraft } from '@/mail/send';
import { sendWithUndo } from '@/mail/undo-send';
import { ask } from '@/utils/dialog';
import { formatSize } from '@/utils/size';
import { showError, showToast } from '@/utils/toast';

// `original` is the message replied to or forwarded, where forwarded attachments come from.
type ComposerProps = { sender: Sender; mode?: ReplyMode; prefill?: Prefill; original?: MessageRef; recipient?: Address };

// Long enough to skip most keystrokes, short enough that a crash loses little.
const AUTOSAVE_DELAY = 500;

let pickCount = 0;

const forwardKey = (info: AttachmentInfo) => `forward/${info.index}`;

const attachment = (filename: string, mimeType: string | undefined, data: ArrayBuffer): DraftAttachment => ({
  key: `picked/${pickCount++}`,
  filename,
  mimeType: mimeType || 'application/octet-stream',
  size: data.byteLength,
  data,
});

// iOS hands HEIC photos over as JPEG in its compatible mode; the name follows the format it got.
async function pickPhotos(): Promise<DraftAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (asset, i) => {
      const jpeg = asset.mimeType === 'image/jpeg';
      const name = asset.fileName ?? `photo-${i + 1}.jpg`;
      const filename = jpeg ? name.replace(/\.(heic|heif)$/i, '.jpg') : name;
      return attachment(filename, asset.mimeType, await new File(asset.uri).arrayBuffer());
    }),
  );
}

async function pickAttachments(): Promise<DraftAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (asset) =>
      attachment(asset.name, asset.mimeType, await (asset.file ? asset.file.arrayBuffer() : new File(asset.uri).arrayBuffer())),
    ),
  );
}

export function Composer({ sender: initialSender, mode, prefill, original, recipient }: ComposerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const accounts = useAccounts();
  const choices = senders(accounts);
  const slot = original
    ? `${mode}/${original.account}/${original.mailbox}/${original.uid}`
    : `new/${recipient?.email ?? ''}`;
  // A message taken back with Undo comes with its attachments; a draft kept on the device reads them below.
  const [returned] = useState(() => takeBack(slot));
  const [saved] = useState(() => returned?.draft ?? readLocalDraft(slot));
  const [sender, setSender] = useState(
    () =>
      choices.find((s) => s.account === saved?.account && s.address.email === saved.from.email) ?? initialSender,
  );
  const [to, setTo] = useState(saved?.to ?? emptyRecipients(prefill?.to ?? (recipient && [recipient])));
  const [cc, setCc] = useState(saved?.cc ?? emptyRecipients(prefill?.cc));
  const [bcc, setBcc] = useState(saved?.bcc ?? emptyRecipients());
  const [showCopies, setShowCopies] = useState(() => allRecipients(cc).length + allRecipients(bcc).length > 0);
  const [subject, setSubject] = useState(saved?.subject ?? prefill?.subject ?? '');
  const quoted = prefill?.text ?? '';
  const signatureOf = (account: string) => accounts.find((a) => a.id === account)?.signature;
  const [text, setText] = useState(saved?.text ?? sign(quoted, signatureOf(sender.account)));
  // Typing starts above the quoted text and the signature; the user's own moves take over after.
  const [selection, setSelection] = useState(text && !saved ? { start: 0, end: 0 } : undefined);
  // A reopened draft's attachments load from the database; until then nothing is written over them.
  const [restored, setRestored] = useState(!saved || !!returned);
  const [attachments, setAttachments] = useState<DraftAttachment[]>(
    () =>
      returned?.attachments ??
      (saved ? [] : (prefill?.attachments ?? [])).map((info) => ({
        key: forwardKey(info),
        filename: info.filename ?? t('mail.reader.attachment'),
        mimeType: info.mimeType,
        size: info.size,
      })),
  );
  const [touched, setTouched] = useState(!!saved);
  const [barHeight, setBarHeight] = useState(0);
  const unsaved = useRef<LocalDraft | null>(null);

  useEffect(() => {
    if (!touched) return;
    unsaved.current = { account: sender.account, from: sender.address, to, cc, bcc, subject, text };
    const timer = setTimeout(() => {
      if (unsaved.current) writeLocalDraft(slot, unsaved.current);
      unsaved.current = null;
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [slot, touched, sender, to, cc, bcc, subject, text]);

  // Leaving by a gesture or the browser skips Cancel, so the last keystrokes are written on the way out.
  useEffect(
    () => () => {
      if (unsaved.current) writeLocalDraft(slot, unsaved.current);
    },
    [slot],
  );

  useEffect(() => {
    if (!touched || !restored) return;
    mailStore()
      .then((store) => store.setDraftAttachments(slot, attachments))
      .catch((error: unknown) =>
      showError(t('compose.attachmentsNotKept'), explainError(error).summary),
    );
  }, [slot, touched, restored, attachments, t]);

  // Runs once: the prefill is fixed for the composer's lifetime. A chip removed while it downloads stays removed,
  // and a reopened draft fetches only the forwarded attachments that hadn't finished.
  useEffect(() => {
    let open = true;
    const fetchMissing = (list: DraftAttachment[]) => {
      const missing = prefill?.attachments.filter((info) => list.some((a) => a.key === forwardKey(info) && !a.data));
      if (!original || !missing?.length) return;
      void fetchForwarded(
        original,
        missing,
        (info, data) => {
          if (open) setAttachments((list) => list.map((a) => (a.key === forwardKey(info) ? { ...a, data } : a)));
        },
        (info, error) => {
          if (!open) return;
          setAttachments((list) => list.filter((a) => a.key !== forwardKey(info)));
          showError(
            t('compose.forwardFailed', { name: info.filename ?? t('mail.reader.attachment') }),
            explainError(error).summary,
          );
        },
      );
    };
    if (!saved || returned) fetchMissing(attachments);
    else
      mailStore()
        .then((store) => store.draftAttachments(slot))
        .then(
        (list) => {
          if (!open) return;
          setAttachments(list);
          setRestored(true);
          fetchMissing(list);
        },
        (error: unknown) => showError(t('compose.attachmentsNotRestored'), explainError(error).summary),
      );
    return () => {
      open = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setTouched(true);
      set(value);
    };

  const pickSender = (picked: Sender) => {
    edit(setSender)(picked);
    setText(resign(text, quoted, signatureOf(sender.account), signatureOf(picked.account)));
    setLastFrom(picked.address.email);
  };

  const recipients = [to, cc, bcc].flatMap(allRecipients);
  const downloading = attachments.some((a) => !a.data);
  const canSend = recipients.length > 0 && recipients.every((a) => isEmail(a.email)) && !downloading;

  const draft = (): Draft => ({
    from: sender.address,
    to: allRecipients(to),
    cc: allRecipients(cc),
    bcc: allRecipients(bcc),
    subject,
    text,
    inReplyTo: prefill?.inReplyTo,
    references: prefill?.references ?? [],
    attachments: attachments.flatMap(({ filename, mimeType, data }): OutgoingAttachment[] =>
      data ? [{ filename, mimeType, data }] : [],
    ),
  });

  const close = () => {
    unsaved.current = null;
    removeLocalDraft(slot).catch((error: unknown) => showError(t('common.actionFailed'), explainError(error).summary));
    router.back();
  };

  const send = useMutation({
    mutationFn: () => {
      const local: LocalDraft = { account: sender.account, from: sender.address, to, cc, bcc, subject, text };
      const files = attachments;
      return sendWithUndo(sender.account, draft(), () => {
        handBack(slot, local, files);
        router.push({
          pathname: '/compose',
          params: original
            ? { mode, ...messageParams(original) }
            : { to: recipient?.email },
        });
      });
    },
    onSuccess: close,
  });

  const save = useMutation({
    mutationFn: () => saveDraft(getAccount(sender.account), draft()),
    onSuccess: () => {
      showToast(t('compose.draftSaved'));
      close();
    },
  });

  const attach = useMutation({
    mutationFn: (from: 'files' | 'photos') => (from === 'photos' ? pickPhotos() : pickAttachments()),
    onSuccess: (picked) => {
      if (picked.length) edit(setAttachments)([...attachments, ...picked]);
    },
  });

  const dropping = useFileDrop((files) => {
    Promise.all(files.map(async (file) => attachment(file.name, file.type, await file.arrayBuffer()))).then(
      (dropped) => {
        setTouched(true);
        setAttachments((list) => [...list, ...dropped]);
      },
      (error: unknown) => showError(t('common.actionFailed'), explainError(error).summary),
    );
  });

  const busy = send.isPending || save.isPending;

  const cancel = () => {
    if (!touched) return router.back();
    ask(t('compose.closeTitle'), [
      { label: t('compose.keepEditing'), style: 'cancel' },
      { label: t('compose.discard'), style: 'destructive', onPress: close },
      ...(downloading ? [] : [{ label: t('compose.saveDraft'), onPress: () => save.mutate() }]),
    ]);
  };

  const title = mode ? t(`compose.title.${mode}`) : t('compose.title.new');

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable
              onPress={cancel}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              style={styles.headerButton}>
              {Platform.OS === 'android' ? (
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={24}
                  tintColor={theme.heading}
                />
              ) : (
                <ThemedText type="label" themeColor="primary">
                  {t('common.cancel')}
                </ThemedText>
              )}
            </Pressable>
          ),
          headerRight: () =>
            send.isPending ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              <Pressable
                onPress={() => send.mutate()}
                disabled={!canSend || busy}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSend || busy }}
                style={styles.headerButton}>
                <ThemedText type="label" themeColor={canSend && !busy ? 'primary' : 'muted'}>
                  {t('compose.send')}
                </ThemedText>
              </Pressable>
            ),
        }}
      />
      <View style={[styles.screen, { backgroundColor: theme.page }]}>
        <KeyboardAwareScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scroll}
          bottomOffset={barHeight + Spacing.three}
          keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            {choices.length > 1 ? (
              <SenderPicker senders={choices} value={sender} onChange={pickSender} />
            ) : (
              <ThemedText type="meta" style={[styles.from, { borderBottomColor: theme.border }]}>
                {t('compose.fromLine', { email: sender.address.email })}
              </ThemedText>
            )}
            <AddressField
              label={t('compose.to')}
              value={to}
              onChange={edit(setTo)}
              autoFocus={mode !== 'reply' && mode !== 'replyAll' && !recipient}
            />
            {showCopies ? (
              <>
                <AddressField label={t('compose.cc')} value={cc} onChange={edit(setCc)} />
                <AddressField label={t('compose.bcc')} value={bcc} onChange={edit(setBcc)} />
              </>
            ) : (
              <Pressable
                onPress={() => setShowCopies(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.copies,
                  { borderBottomColor: theme.border },
                  pressed && { opacity: Press.opacity },
                ]}>
                <ThemedText type="meta" themeColor="primary">
                  {t('compose.addCopies')}
                </ThemedText>
              </Pressable>
            )}
            <TextInput
              value={subject}
              onChangeText={edit(setSubject)}
              placeholder={t('compose.subject')}
              placeholderTextColor={theme.muted}
              selectionColor={theme.primary}
              accessibilityLabel={t('compose.subject')}
              style={[styles.subject, { color: theme.heading, borderBottomColor: theme.border }, frameless]}
            />
            <TextInput
              value={text}
              onChangeText={edit(setText)}
              placeholder={t('compose.body')}
              placeholderTextColor={theme.muted}
              selectionColor={theme.primary}
              accessibilityLabel={t('compose.body')}
              autoFocus={mode === 'reply' || mode === 'replyAll' || !!recipient}
              selection={selection}
              onSelectionChange={({ nativeEvent: { selection: at } }) => {
                if (!selection) return;
                // Android moves the cursor to the end as the field takes focus, after the start was applied, so the
                // start is applied again until the field reports it.
                setSelection(at.start === 0 && at.end === 0 ? undefined : { start: 0, end: 0 });
              }}
              multiline
              textAlignVertical="top"
              style={[styles.body, { color: theme.heading }, frameless]}
            />
            {attachments.length > 0 && (
              <View style={styles.attachments}>
                {attachments.map((attachment) => (
                  <Pressable
                    key={attachment.key}
                    onPress={() => edit(setAttachments)(attachments.filter((a) => a.key !== attachment.key))}
                    accessibilityRole="button"
                    accessibilityLabel={t('compose.removeAttachment', { name: attachment.filename })}
                    accessibilityHint={attachment.data ? undefined : t('compose.attachmentLoading')}
                    style={({ pressed }) => [
                      styles.attachment,
                      { borderColor: theme.outline },
                      pressed && { opacity: Press.opacity },
                    ]}>
                    <ThemedText type="labelSmall" numberOfLines={1} style={styles.attachmentName}>
                      {attachment.filename}
                    </ThemedText>
                    {!attachment.data && <ActivityIndicator size="small" color={theme.primary} />}
                    <ThemedText type="meta">{formatSize(attachment.size)}</ThemedText>
                    <SymbolView
                      name={{ ios: 'xmark', android: 'close', web: 'close' }}
                      size={12}
                      tintColor={theme.muted}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>
        <KeyboardStickyView
          offset={{ opened: insets.bottom }}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
          style={[
            styles.bar,
            { backgroundColor: theme.page, borderTopColor: theme.border, paddingBottom: insets.bottom + Spacing.two },
          ]}>
          <View style={styles.tools}>
            <Button
              label={t('compose.attach')}
              variant="outline"
              size="small"
              loading={attach.isPending && attach.variables === 'files'}
              onPress={() => attach.mutate('files')}
            />
            {Platform.OS !== 'web' && (
              <Button
                label={t('compose.attachPhotos')}
                variant="outline"
                size="small"
                loading={attach.isPending && attach.variables === 'photos'}
                onPress={() => attach.mutate('photos')}
              />
            )}
            <Button
              label={t('compose.saveDraft')}
              variant="outline"
              size="small"
              loading={save.isPending}
              disabled={busy || downloading}
              onPress={() => save.mutate()}
            />
          </View>
        </KeyboardStickyView>
        {dropping && (
          <View style={[styles.drop, { backgroundColor: theme.accentSoft, borderColor: theme.primary }]}>
            <ThemedText type="label" themeColor="onAccentSoft">
              {t('compose.drop')}
            </ThemedText>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    minHeight: 44,
    justifyContent: 'center',
    // Native headers inset their items; the web header does not.
    paddingHorizontal: Platform.OS === 'web' ? Spacing.three : 0,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  column: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ColumnWidth,
  },
  from: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
  copies: {
    minHeight: TouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderBottomWidth: Hairline,
  },
  subject: {
    ...textStyles.input,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: Hairline,
  },
  body: {
    ...textStyles.body,
    flexGrow: 1,
    minHeight: 240,
    padding: Spacing.three,
  },
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget - Spacing.one,
    maxWidth: '100%',
    paddingHorizontal: Spacing.three,
    borderWidth: Hairline,
    borderRadius: Radius.md,
  },
  attachmentName: {
    flexShrink: 1,
  },
  drop: {
    ...StyleSheet.absoluteFill,
    margin: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    pointerEvents: 'none',
  },
  bar: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: Hairline,
  },
  tools: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
    maxWidth: ColumnWidth,
  },
});
