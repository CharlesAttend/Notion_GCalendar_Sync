// const { Client } = require(client)
import { config } from "dotenv"
config()
import { Client } from "@notionhq/client"
import { getEvent, addEvent, updateEvent, removeEvent } from "./g_calendar.js"
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
    setInterval(findAndUpdateCalendarEvent, 5000)
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

async function findAndUpdateCalendarEvent() {
  // Get the tasks currently in the database.
  console.log("\nFetching tasks from Notion DB...")
  const currentTasks = await getTasksFromNotionDatabase()
  await updateCalendarEventForUpdatedTasks(currentTasks);
  // await updateCalendarEventForRemovedTasks(currentTasks);
}

async function updateCalendarEventForUpdatedTasks(currentTasks) {
  // Return any tasks that have had their status updated.
  const updatedTasks = findUpdatedTasks(currentTasks)
  console.log(`Found ${updatedTasks.length} updated tasks.`)
  if(updatedTasks.length !== 0){
    const filteredTask = updatedTasks
      .filter(task => task.planned_on.start.length === 29) // test if one date + one hours
      .map(task => {
        // Checking if there is an end date 

        return {
          pageId: task.pageId,
          task : task.task,
          description : task.description,
          planned_on : task.planned_on,
        }
      })
    console.log(`${updatedTasks.length - filteredTask.length} pages filtered.`);
    console.log(`${filteredTask.length} pages remaining after.`);
    console.log(filteredTask);
  
    filteredTask.forEach(task => {
      taskPageIdToStatusMap[task.pageId] = task.planned_on

      
      let endString = "";
      if(!task.planned_on.end){
        const start_date = new Date(task.planned_on.start)
        //const end = new Date(start_date.setHours(start_date.getHours()+1)).setUTCHours(2           
        
        // If not add one hour to the start date by default
        const end = new Date(start_date.setUTCHours(start_date.getHours()+1))
        endString = new Date(end).toISOString()
      }
      const event = {
        'id': task.pageId,
        'summary': task.task,
        'description': task.description,
        'start': {
          'dateTime': task.planned_on.start,
          'timeZone': 'Europe/Paris',
        },
        'end': {
          'dateTime': endString,
          'timeZone': 'Europe/Paris',
        },
      };
  
      if(createdTask[task.pageId]){
        updateEvent(auth, event)
      }
      else{
        addEvent(auth, event)
          .then(() => createdTask[task.pageId] = true)
      }
    })
  }
}

async function updateCalendarEventForRemovedTasks(currentTasks) {

  // Return any tasks that have had their status updated.
  const removedTasks = findRemovedTasks(currentTasks)
  console.log(`Found ${removedTasks.length} removed tasks.`)

  removedTasks.forEach(task => {
    taskPageIdToStatusMap[task.pageId] = task.planned_on    
    removeEvent(auth, task.id)
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
  return pages  
    .map(page => {
      const pageId = page.id.replace(/-/g, "") // Making id google calendar friendly
      const planned_on = page.properties['Planned_on'].date
      const description = page.properties['Description'].rich_text.map(({ plain_text }) => plain_text).join()
      const task = page.properties["Task"].title.map(({ plain_text }) => plain_text).join()
      return {
        pageId: pageId, 
        task,
        description,
        planned_on,
      }
    })
}

/**
 * Compares task to most recent version of task stored in taskPageIdToStatusMap.
 * Returns any tasks that have a different status than their last version.
 *
 * @param {Array<{ pageId: string, task: string, description: string, planned_on: {start: string, end: string} }>} currentTasks
 * @returns {Array<{ pageId: string, task: string, description: string, planned_on: {start: string, end: string} }>}
 */
function findUpdatedTasks(currentTasks) {
  const newTask = currentTasks.filter(currentTask => {
    const previousPlannedOn = getPreviousTaskPlannedOn(currentTask)
    return JSON.stringify(currentTask.planned_on) !== JSON.stringify(previousPlannedOn) 
  })
  return newTask
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