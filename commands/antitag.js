const { setAntitag, getAntitag, removeAntitag } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');

async function handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '```For Group Admins Only!```' }, { quoted: message });
            return;
        }

        const prefix = '.';
        const args = userMessage.slice(9).toLowerCase().trim().split(' ');
        const action = args[0];

        if (!action) {
            const usage = `\`\`\`ANTITAG SETUP\n\n${prefix}antitag on\n${prefix}antitag set delete | kick\n${prefix}antitag off\n\`\`\``;
            await sock.sendMessage(chatId, { text: usage }, { quoted: message });
            return;
        }

        switch (action) {
            case 'on':
                const existingConfig = await getAntitag(chatId, 'on');
                // FIX: Check if antitag is already enabled
                if (existingConfig && existingConfig.enabled) {
                    await sock.sendMessage(chatId, { text: '*_Antitag is already on_*' }, { quoted: message });
                    return;
                }
                // FIX: Set with proper structure
                const result = await setAntitag(chatId, 'on', 'delete');
                await sock.sendMessage(chatId, { 
                    text: result ? '*_Antitag has been turned ON_*' : '*_Failed to turn on Antitag_*' 
                }, { quoted: message });
                break;

            case 'off':
                await removeAntitag(chatId, 'on');
                await sock.sendMessage(chatId, { text: '*_Antitag has been turned OFF_*' }, { quoted: message });
                break;

            case 'set':
                if (args.length < 2) {
                    await sock.sendMessage(chatId, { 
                        text: `*_Please specify an action: ${prefix}antitag set delete | kick_*` 
                    }, { quoted: message });
                    return;
                }
                const setAction = args[1];
                if (!['delete', 'kick'].includes(setAction)) {
                    await sock.sendMessage(chatId, { 
                        text: '*_Invalid action. Choose delete or kick._*' 
                    }, { quoted: message });
                    return;
                }
                // FIX: Check if antitag is enabled before setting action
                const currentConfig = await getAntitag(chatId, 'on');
                if (!currentConfig || !currentConfig.enabled) {
                    await sock.sendMessage(chatId, { 
                        text: '*_Please enable antitag first using .antitag on_*' 
                    }, { quoted: message });
                    return;
                }
                const setResult = await setAntitag(chatId, 'on', setAction);
                await sock.sendMessage(chatId, { 
                    text: setResult ? `*_Antitag action set to ${setAction}_*` : '*_Failed to set Antitag action_*' 
                }, { quoted: message });
                break;

            case 'get':
                const status = await getAntitag(chatId, 'on');
                // FIX: Remove redundant database call
                await sock.sendMessage(chatId, { 
                    text: `*_Antitag Configuration:_*\nStatus: ${status && status.enabled ? 'ON' : 'OFF'}\nAction: ${status ? (status.action || 'delete') : 'Not set'}` 
                }, { quoted: message });
                break;

            default:
                await sock.sendMessage(chatId, { text: `*_Use ${prefix}antitag for usage._*` }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in antitag command:', error);
        await sock.sendMessage(chatId, { text: '*_Error processing antitag command_*' }, { quoted: message });
    }
}

async function handleTagDetection(sock, chatId, message, senderId) {
    try {
        // FIX: Get antitag setting once
        const antitagSetting = await getAntitag(chatId, 'on');
        if (!antitagSetting || !antitagSetting.enabled) return;

        // Get mentioned JIDs from contextInfo (proper mentions)
        const mentionedJids = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        
        // Extract text from all possible message types
        const messageText = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        );

        // FIX: Improved mention detection
        const textMentions = messageText.match(/@[\d+\s\-()~.]+/g) || [];
        const numericMentions = messageText.match(/@\d{10,}/g) || [];
        
        // Combine all detected mentions
        const allDetectedMentions = [...mentionedJids, ...textMentions, ...numericMentions];
        
        // Count unique mentions (avoid duplicates)
        const uniqueMentions = new Set();
        
        // Add proper mentions from JIDs
        mentionedJids.forEach(jid => {
            if (jid && jid !== 'undefined@s.whatsapp.net') {
                uniqueMentions.add(jid);
            }
        });
        
        // Add text mentions
        textMentions.forEach(mention => uniqueMentions.add(mention));
        numericMentions.forEach(mention => uniqueMentions.add(mention));

        const totalUniqueMentions = uniqueMentions.size;

        // FIX: Better threshold logic
        if (totalUniqueMentions >= 3) {
            // Get group metadata for threshold calculation
            const groupMetadata = await sock.groupMetadata(chatId);
            const participants = groupMetadata.participants || [];
            const totalParticipants = participants.length;
            
            // FIX: Dynamic threshold based on group size
            let mentionThreshold;
            if (totalParticipants <= 10) {
                mentionThreshold = 3; // Small groups
            } else if (totalParticipants <= 30) {
                mentionThreshold = Math.ceil(totalParticipants * 0.4); // Medium groups
            } else {
                mentionThreshold = Math.ceil(totalParticipants * 0.3); // Large groups
            }
            
            // FIX: Check if mentions exceed threshold
            const isMassMention = totalUniqueMentions >= mentionThreshold;
            const hasManyNumericMentions = numericMentions.length >= 5;

            if (isMassMention || hasManyNumericMentions) {
                const action = antitagSetting.action || 'delete';
                
                if (action === 'delete') {
                    // Try to delete the message
                    try {
                        await sock.sendMessage(chatId, {
                            delete: {
                                remoteJid: chatId,
                                fromMe: false,
                                id: message.key.id,
                                participant: senderId
                            }
                        });
                    } catch (deleteError) {
                        console.error('Failed to delete message:', deleteError);
                    }
                    
                    // Send warning
                    await sock.sendMessage(chatId, {
                        text: `⚠️ *Tagall Detected!*\nMessage deleted for mentioning too many members.`
                    });
                    
                } else if (action === 'kick') {
                    // First try to delete the message
                    try {
                        await sock.sendMessage(chatId, {
                            delete: {
                                remoteJid: chatId,
                                fromMe: false,
                                id: message.key.id,
                                participant: senderId
                            }
                        });
                    } catch (deleteError) {
                        console.error('Failed to delete message:', deleteError);
                    }

                    // Then try to kick the user
                    try {
                        await sock.groupParticipantsUpdate(chatId, [senderId], "remove");
                        
                        // Send notification
                        await sock.sendMessage(chatId, {
                            text: `🚫 *Antitag Detected!*\n\nUser has been kicked for mass mentioning members.`,
                            mentions: [senderId]
                        });
                    } catch (kickError) {
                        console.error('Failed to kick user:', kickError);
                        await sock.sendMessage(chatId, {
                            text: `⚠️ *Tagall Detected!*\nFailed to kick user (insufficient permissions).`
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in tag detection:', error);
    }
}

module.exports = {
    handleAntitagCommand,
    handleTagDetection
};
