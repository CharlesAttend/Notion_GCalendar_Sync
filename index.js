// const { Client } = require(client)
import { config } from "dotenv"
config()
import { Client } from "@notionhq/client"
import { getEvent, addEvent, updateEvent } from "./g_calendar.js"
/**
 * Initialisation of Notion API objects
 */
const databaseId = process.env.NOTION_DATABASE_ID
const notion = new Client({ auth: process.env.NOTION_API_KEY})

/**
 * Local map to store task pageId to its last status.
 * { [pageId: string]: string }
 */
const taskPageIdToStatusMap = {}
/**
 * Local map to store per taskId to its google calendar created event.
 * { [pageId: string]: string }
 */
const createdTask = {}

let auth = {}

export function startSync(Oauth) {
  auth = Oauth;
  /**
   * Initialize local data store.
   * Then poll for changes every 5 seconds (5000 milliseconds).
   */ 
  setInitialTaskPageIdToStatusMap(auth).then(() => {
    setInterval(findAndUpdateCalendarEventForUpdatedTasks, 5000)
    // getTasksFromNotionDatabase()
    //   .then((r) => console.log(r))
  })
}


/**
 * Get and set the initial data store with tasks currently in the database.
 */
async function setInitialTaskPageIdToStatusMap(auth) {
  const currentTasks = await getTasksFromNotionDatabase()
  for (const { pageId, planned_on } of currentTasks){
    taskPageIdToStatusMap[pageId] = planned_on
    const isAlreadyCreated = await getEvent(auth, pageId) 
    createdTask[pageId] = isAlreadyCreated ? true : false 
  }
  console.log("List of event in Google Calendar : \n ", createdTask);
}

async function findAndUpdateCalendarEventForUpdatedTasks() {
  // Get the tasks currently in the database.
  console.log("\nFetching tasks from Notion DB...")
  const currentTasks = await getTasksFromNotionDatabase()

  // Return any tasks that have had their status updated.
  const updatedTasks = findUpdatedTasks(currentTasks)
  console.log(`Found ${updatedTasks.length} updated tasks.`)

  updatedTasks.forEach(task => {
    taskPageIdToStatusMap[task.pageId] = task.planned_on
    const event = {
      'id': task.pageId,
      'summary': task.task,
      'description': task.description,
      'start': {
        'dateTime': task.planned_on.start,
        'timeZone': 'Europe/Paris',
      },
      'end': {
        'dateTime': task.planned_on.end,
        'timeZone': 'Europe/Paris',
      },
    };
    addEvent(auth, event)
  })
}

/**
 * Gets tasks from the database.
 *
 * @returns {Promise<Array<{ pageId: string, task: string, description: string, planned_on: {start: string, end: string} }>>}
 */
async function getTasksFromNotionDatabase() {
  const pages = []
  let cursor = undefined

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: 
      {
        and: 
        [{
          property: "Planned_on",
          date: {
            is_not_empty: true
          }
        },
        {
          property: "Checked",
          checkbox: {
            equals: false,
          }
        }]
      }
    })

    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }

  console.log(`${pages.length} pages successfully fetched.`)

  const filteredPages = pages
    .filter(page => page.properties['Planned_on'].date.start.length === 29) // test if date + hours
    .map(page => {
      let planned_on = page.properties['Planned_on'].date

      // Checking if there is an end date 
      if(!planned_on.end){
        const start_date = new Date(planned_on.start)
        //const end = new Date(start_date.setHours(start_date.getHours()+1)).setUTCHours(2)

        // If not add one hour to the start date by default
        const end = new Date(start_date.setUTCHours(start_date.getHours()+1))
        planned_on.end = new Date(end).toISOString()
      }
      const description = page.properties['Description'].rich_text.map(({ plain_text }) => plain_text).join()
      const task = page.properties["Task"].title.map(({ plain_text }) => plain_text).join()
      return {
        pageId: page.id.replace(/-/g, ""), // Making id google calendar friendly
        task,
        description,
        planned_on,
      }
    })
    console.log(`${pages.length - filteredPages.length} pages filtered.`);
    console.log(`${filteredPages.length} pages remaining after.`);
    console.log(filteredPages);
  return filteredPages
}

/**
 * Compares task to most recent version of task stored in taskPageIdToStatusMap.
 * Returns any tasks that have a different status than their last version.
 *
 * @param {Array<{ pageId: string, task: string, description: string, planned_on: {start: string, end: string} }>} currentTasks
 * @returns {Array<{ pageId: string, task: string, description: string, planned_on: {start: string, end: string} }>}
 */
function findUpdatedTasks(currentTasks) {
  return currentTasks.filter(currentTask => {
    const previousPlannedOn = getPreviousTaskPlannedOn(currentTask)
    return JSON.stringify(currentTask.planned_on) !== JSON.stringify(previousPlannedOn) 
  })
}

/**
 * Finds or creates task in local data store and returns its status.
 * @param {{ pageId: string; planned_on: {start: string, end: string} }}
 * @returns {string}
 */
function getPreviousTaskPlannedOn({ pageId, planned_on }) {
  // If this task hasn't been seen before, add to local pageId to status map.
  if (!taskPageIdToStatusMap[pageId]) {
    taskPageIdToStatusMap[pageId] = planned_on
    return false
  }
  return taskPageIdToStatusMap[pageId]
}