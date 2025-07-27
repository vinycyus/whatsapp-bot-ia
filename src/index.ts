import wppconnect from '@wppconnect-team/wppconnect';
import dotenv from 'dotenv';
import terminalKit from 'terminal-kit';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';

import { initializeNewAIChatSession, mainOpenAI } from './service/openai';
import { mainGoogle } from './service/google';
import { splitMessages, sendMessagesWithDelay } from './util';

dotenv.config();

const term = terminalKit.terminal;

const messageBufferPerChatId = new Map<string, string[]>();
const messageTimeouts = new Map<string, NodeJS.Timeout>();
const pausedChats = new Map<string, boolean>();
const humanTimeouts = new Map<string, NodeJS.Timeout>();

const AI_SELECTED = (process.env.AI_SELECTED as 'GPT' | 'GEMINI') || 'GEMINI';
const MAX_RETRIES = 3;

if (AI_SELECTED === 'GEMINI' && !process.env.GEMINI_KEY) {
  throw Error('Você precisa colocar uma key do Gemini no .env!');
}

if (AI_SELECTED === 'GPT' && (!process.env.OPENAI_KEY || !process.env.OPENAI_ASSISTANT)) {
  throw Error('Para utilizar o GPT, configure OPENAI_KEY e OPENAI_ASSISTANT no .env.');
}

wppconnect
  .create({
    session: 'sessionName',
    catchQR: async (base64Qrimg, asciiQR, attempts, urlCode) => {
      console.clear();
      console.log('Tentativas:', attempts);
      if (urlCode) {
        const qrText = await qrcode.toString(urlCode, { type: 'terminal' });
        term(qrText);
      }
    },
    statusFind: (statusSession, session) => {
      console.log('Status Session: ', statusSession);
      console.log('Session name: ', session);
    },
    headless: true,
    browserArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
  })
  .then((client) => start(client))
  .catch((error) => console.error('Erro ao iniciar o cliente:', error));

async function start(client: wppconnect.Whatsapp): Promise<void> {
  client.onAck(async (ack) => {
    const chatId = ack.to;
    const messageBody = ack.body?.trim() || '';

    if (pausedChats.has(chatId)) return;

    if (messageBody.includes('🔍')) {
      pausedChats.set(chatId, true);
      await client.sendText(chatId, '🔔 Um atendente humano assumirá a conversa agora. Aguarde um momento.');

      if (humanTimeouts.has(chatId)) clearTimeout(humanTimeouts.get(chatId)!);
      const timeout = setTimeout(async () => {
        pausedChats.delete(chatId);
        humanTimeouts.delete(chatId);
        messageBufferPerChatId.delete(chatId);
        messageTimeouts.delete(chatId);
        await client.sendText(chatId, '⚠️ A conversa foi encerrada automaticamente por inatividade.');
      }, 5 * 60 * 1000);
      humanTimeouts.set(chatId, timeout);
    }
  });

  client.onMessage((message) => {
    (async () => {
      // Processa só mensagens de texto, ignora áudio e ptt
      if (message.type !== 'chat') return;
      if (message.isGroupMsg || message.chatId === 'status@broadcast') return;

      const chatId = message.chatId.toString();
      let body = message.body?.trim() || '';

      if (pausedChats.has(chatId)) {
        if (humanTimeouts.has(chatId)) clearTimeout(humanTimeouts.get(chatId)!);
        const timeout = setTimeout(async () => {
          pausedChats.delete(chatId);
          humanTimeouts.delete(chatId);
          messageBufferPerChatId.delete(chatId);
          messageTimeouts.delete(chatId);
          await client.sendText(chatId, '⚠️ A conversa foi encerrada automaticamente por inatividade.');
        }, 5 * 60 * 1000);
        humanTimeouts.set(chatId, timeout);
        return;
      }

      console.log('Mensagem recebida:', body);

      if (AI_SELECTED === 'GPT') {
        await initializeNewAIChatSession(chatId);
      }

      if (!messageBufferPerChatId.has(chatId)) {
        messageBufferPerChatId.set(chatId, [body]);
      } else {
        messageBufferPerChatId.set(chatId, [...messageBufferPerChatId.get(chatId)!, body]);
      }

      if (messageTimeouts.has(chatId)) {
        clearTimeout(messageTimeouts.get(chatId)!);
      }

      messageTimeouts.set(chatId, setTimeout(async () => {
        const currentMessage = messageBufferPerChatId.get(chatId)!.join(' \n ');

        let answer = '';
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            answer = AI_SELECTED === 'GPT'
              ? await mainOpenAI({ currentMessage, chatId })
              : await mainGoogle({ currentMessage, chatId });
            break;
          } catch (err) {
            if (attempt === MAX_RETRIES) throw err;
          }
        }

        const messages = splitMessages(answer);
        await sendMessagesWithDelay({ client, messages, targetNumber: message.from });
        await client.stopTyping(chatId);

        messageBufferPerChatId.delete(chatId);
        messageTimeouts.delete(chatId);
      }, 15000));
    })();
  });
}

export {}; // evita conflito de tipos
