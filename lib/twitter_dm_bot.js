'use strict';

const _unescape = require('lodash').unescape;
const _partition = require('lodash').partition;
const BaseBot = require('botmaster').BaseBot;
const Twit = require('twit');

class TwitterDMBot extends BaseBot {

  constructor(settings) {
    super(settings);
    this.type = 'twitter-dm';
    this.requiresWebhook = false;
    this.requiredCredentials = ['consumerKey', 'consumerSecret',
      'accessToken', 'accessTokenSecret'];
    this.receives = {
      text: true,
      attachment: {
        audio: true,
        file: true,
        image: true,
        video: true,
        location: false,
        fallback: false,
      },
      echo: false,
      read: false,
      delivery: false,
      postback: false,
      quickReply: false,
    };

    this.sends = {
      text: true,
      quickReply: true,
      locationQuickReply: false,
      senderAction: {
        typingOn: false,
        typingOff: false,
        markSeen: false,
      },
      attachment: {
        audio: true,
        file: true,
        image: true,
        video: true,
      },
    };

    this.retrievesUserInfo = false;
    this.__applySettings(settings);
    this.__setupTwit();
  }

  __setupTwit() {
    // transpile to snake_case
    const twitCredentials = {
      consumer_key: this.credentials.consumerKey,
      consumer_secret: this.credentials.consumerSecret,
      access_token: this.credentials.accessToken,
      access_token_secret: this.credentials.accessTokenSecret,
    };
    const twit = new Twit(twitCredentials);
    this.idStr = this.credentials.accessToken.split('-')[0];
    this.id = this.idStr;
    this.twit = twit;
	this.timer = setInterval(this.__pollForMessages.bind(this),60000);
	this.__pollForMessages();
	
    /*const userStream = twit.stream('user');

    this.userStream = userStream;

    userStream.on('direct_message', (rawUpdate) => {
      // otherwise, Bot will receive what it just sent
      if (rawUpdate.direct_message.sender.id_str !== this.id) {
        const update = this.__formatUpdate(rawUpdate);
        this.__emitUpdate(update);
      }
    });*/
  }

  __pollForMessages() {
	  console.log("polling now...");
	let self = this;
	let newEvents = [];
	this.twit.get('direct_messages/events/list',{count: 50}, function (err, data, response) {
		try {
			console.log("got " + data.events.length + " events, latest id=" + data.events[0].id);
			let events = data.events;
			for (let i=0; i<events.length; i++){
				if (!self.lastEvent) {
						console.log("setting lastEvent=" + events[0].id)
						self.lastEvent = events[0].id; // mark the newest event id as already processed (only process new events, not old existing events)
				}
				if (parseInt(events[i].id) > self.lastEvent){
					console.log("unshifting new event " + events[i].id);
					newEvents.unshift(events[i]);
				} else break;
			}
			
			if (newEvents.length > 0){
				self.lastEvent = newEvents[newEvents.length-1].id;
				for (let i=0; i<newEvents.length; i++){
					if (newEvents[i].message_create.sender_id !== self.id) {
						const update = self.__formatUpdate(newEvents[i]);
						self.__emitUpdate(update);
					}
				}
			}
		} catch(e) {
			console.log("ERROR: twitter_dm_bot.js:",e);
		}
	});
  }
  
  __formatUpdate(rawUpdate) {
    const dateSentAt = new Date(rawUpdate.created_timestamp);
    const formattedUpdate = {
      raw: rawUpdate,
      sender: {
        id: rawUpdate.message_create.sender_id,
      },
      recipient: {
        id: this.id,
      },
      timestamp: dateSentAt.getTime(),
      message: {
        mid: rawUpdate.id,
        seq: null, // twitter doesn't have such a concept. Can be emulated with proper storage
      },
    };

    const attachments = this.__formatIncomingAttachments(rawUpdate);

    if (attachments) {
      formattedUpdate.message.attachments = attachments;
    }

    const text = this.__formatIncomingText(rawUpdate);

    if (text) {
      formattedUpdate.message.text = text;
    }

    return formattedUpdate;
  }

  __formatIncomingAttachments(rawUpdate) {
    const media = rawUpdate.message_create.message_data.entities.media;
    if (!media) {
      return null;
    }

    const attachments = media.map((entry) => {
      let type;
      let url;
      if (entry.type === 'photo') {
        type = 'image';
        url = entry.media_url_https;
      } else if (entry.type === 'video') {
        type = 'video';
        url = this.__extractBestVideoURL(entry.video_info.variants);
      } else if (entry.type === 'animated_gif') {
        // weirdly enough twitter's gifs are videos rather than actual
        // .gif files... so I return a video and not an image...
        // Could potentially also return the jpg returned from it. but it's
        // there in raw anyway for the ones who want to go there
        type = 'video';
        url = this.__extractBestVideoURL(entry.video_info.variants);
      }

      const attachment = {
        type,
        payload: {
          url,
        },
      };

      return attachment;
    });

    if (attachments.length > 0) {
      return attachments;
    }

    return null;
  }

  __formatIncomingText(rawUpdate) {
    if (rawUpdate.message_create.message_data.text !== undefined) {
      let text = _unescape(rawUpdate.message_create.message_data.text);
      const media = rawUpdate.message_create.message_data.entities.media;
      if (media && media.length > 0) {
        for (const entry of media) {
          text = text.replace(` ${entry.url}`, '');
        }
      }
      return text;
    }
    return null;
  }

  __extractBestVideoURL(variants) {
    // It is assumed that Messenger quality url is expected
    // to be good but not necessarily the best.

    // get variants that have a bitrate associated to them
    const eligibleVariants = _partition(variants,
      v => v.bitrate !== undefined)[0];

    if (eligibleVariants.length === 0) {
      return null;
    }

    const upperBitrateLimit = 832001;
    // remember, this will start
    const selectedVariant = eligibleVariants.reduce((prevVar, currVar) => {
      if (prevVar.bitrate > upperBitrateLimit &&
        currVar.bitrate < prevVar.bitrate) {
        return currVar;
      }

      if (currVar.bitrate > prevVar.bitrate &&
        currVar.bitrate < upperBitrateLimit) {
        return currVar;
      }

      return prevVar;
    });

    return selectedVariant.url;
  }
  __formatOutgoingMessage(message) {
	let formattedMessage = {
		event: {
			type: "message_create",
			message_create: {
			  target: {
				recipient_id: message.recipient.id,
			  },
			  message_data: {
				text: ''
			  }
			}
		}
    };
	  
    if (message.message.text) {
      formattedMessage.event.message_create.message_data.text = message.message.text;
    }

    if (message.message.attachment) {
      formattedMessage.event.message_create.message_data.text += ` ${message.message.attachment.payload.url}`;
    }

    if (message.message.quick_replies) {

      // convert default(messenger) quick reply structure to twitter supported structure
      const quickReplies = message.message.quick_replies.map(quickReply => ({
        label: quickReply['title'],
        metadata: quickReply['title']
      }))

      const quickReplyFormattedMessage = {
        event: {
          type: "message_create",
          message_create: {
            target: {
              recipient_id: message.recipient.id,
            },
            message_data: {
              text: message.message.text,
              quick_reply: {
                type: "options",
                options: quickReplies
              }
            }
          }
        }
      };
      formattedMessage = quickReplyFormattedMessage
    }

    return formattedMessage;
  }

  __sendMessage(rawMessage) {
    /*
      direct_messages/events/new: to send quick replies
      direct_messages/new: to send normal direct message
    */
console.log("rawMessage:");
console.log(JSON.stringify(rawMessage));
    const sendMessageUrl = 'direct_messages/events/new';
    return new Promise((resolve, reject) => {
      this.twit.post(sendMessageUrl, rawMessage, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
  }

  __createStandardBodyResponseComponents(sentOutgoingMessage, sentRawMessage, rawBody) {
    /*
      if: to capture details for normal text response
      else: to capture details for quick reply response
    */

    if (rawBody.id_str) {
      return {
        recipient_id: rawBody.recipient.id_str,
        message_id: rawBody.id_str,
      };
    } else {
      return {
        recipient_id: rawBody.event.message_create.target.recipient_id,
        message_id: rawBody.event.id
      };
    }
  }
}

module.exports = TwitterDMBot;
