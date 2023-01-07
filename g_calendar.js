import { config } from "dotenv"
config()
import fs from 'fs'
import readline from 'readline'
import {google} from 'googleapis'
import {startSync} from './notion.js'

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = './credentials/token.json';
const CALENDAR_ID = process.env.CALENDAR_ID;

getGoogleAuth()

async function getGoogleAuth(){
  fs.readFile('./credentials/credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Google Calendar API.
    authorize(JSON.parse(content), startSync);
  });
}

export const getEvent = async (auth, eventId) => {
  const calendar = google.calendar({ version: 'v3', auth: auth});
  const event = await calendar.events.get({auth:auth, calendarId: CALENDAR_ID, eventId: eventId})  
    .catch(error => {
      console.error("Error when fetching GCalendar event, probably doesn't exist");
      // console.error(error);
      return false
    });
  return event
}

export const addEvent = async (auth, event) => {
  const calendar = google.calendar({ version: 'v3', auth: auth});
  if(await getEvent(auth, event.id)){
    return 
  }
  const newEvent = await calendar.events.insert({
    auth: auth,
    calendarId: CALENDAR_ID,
    resource: event,
  }, (err, event) => {
    if (err) {
      console.error('There was an error contacting the Calendar service during adding event: ' + err);
      return;
    }
    console.log('Event added: %s', event.config.body);
  })
  return newEvent
}

export const removeEvent = async (auth, eventId) => {
  const calendar = google.calendar({ version: 'v3', auth: auth});
  const removedEvent = await calendar.events.delete({
    auth : auth,
    calendarId: CALENDAR_ID,
    eventId : eventId
  }, (err, event) => {
    if (err) {
      console.error('There was an error contacting the Calendar service during delete event: ' + err);
      return;
    }
    console.log('Event deleted: %s');
  })
  return removedEvent
}

export const updateEvent = async (auth, event) => {
  const calendar = google.calendar({ version: 'v3', auth: auth});
  const updatedEvent = await calendar.events.update({
    auth : auth,
    calendarId : CALENDAR_ID,
    eventId: event.id,
    resource: event,

  }, (err, event) => {
    if (err) {
      console.error('There was an error contacting the Calendar service during update event: ' + err);
      return;
    }
    else {
      console.log('Event updated: %s', event.config.body);
    }
  })
  return updatedEvent
}


/**
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const events = res.data.items;
    if (events.length) {
      console.log('Upcoming 10 events:');
      events.map((event, i) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${start} - ${event.summary}`);
      });
    } else {
      console.log('No upcoming events found.');
    }
  });
}


/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}