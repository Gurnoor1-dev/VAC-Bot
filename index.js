require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

const ALLOWED_ROLE_ID = "PUT_YOUR_ROLE_ID_HERE";
const DATA_FILE = path.join(__dirname, 'tickets.json');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');

let tickets = {};
if (fs.existsSync(DATA_FILE)) {
    tickets = JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveTickets() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

// ===== PDF GENERATOR =====
async function generatePDF(data) {
    let html = fs.readFileSync(TEMPLATE_FILE, 'utf8');

    html = html
        .replace('{{CLIENT_NAME}}', data.client_name)
        .replace('{{PRODUCT}}', data.product)
        .replace('{{ORDER_ID}}', data.id)
        .replace('{{STATUS}}', data.status)
        .replace('{{DATE}}', new Date().toLocaleDateString());

    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfPath = `./${data.id}.pdf`;
    await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true
    });

    await browser.close();

    return pdfPath;
}

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o =>
                o.setName('client')
                    .setDescription('Client Name')
                    .setRequired(true))
            .addStringOption(o =>
                o.setName('product')
                    .setDescription('Product')
                    .setRequired(true)
                    .addChoices(
                        { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                        { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                    ))
            .addStringOption(o =>
                o.setName('status')
                    .setDescription('Status')
                    .setRequired(true)
                    .addChoices(
                        { name: 'In Production Phase', value: 'In Production Phase' },
                        { name: 'In Test Phase', value: 'In Test Phase' },
                        { name: 'Handed off to VA for testing', value: 'Handed off to VA for testing' },
                        { name: 'Test Completed', value: 'Test Completed' },
                        { name: 'Processed', value: 'Processed' }
                    )),

        new SlashCommandBuilder()
            .setName('document')
            .setDescription('Generate designer PDF')
            .addStringOption(o =>
                o.setName('id')
                    .setDescription('Order ID')
                    .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("✅ Bot Ready");
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'addticket') {

        if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
            return interaction.reply({ content: "No permission.", ephemeral: true });
        }

        const clientName = interaction.options.getString('client');
        const product = interaction.options.getString('product');
        const status = interaction.options.getString('status');

        const id = generateID(product);

        tickets[id] = {
            id,
            client_name: clientName,
            product,
            status
        };

        saveTickets();

        return interaction.reply({ content: `Ticket created: ${id}`, ephemeral: true });
    }

    if (interaction.commandName === 'document') {

        await interaction.deferReply({ ephemeral: true });

        const id = interaction.options.getString('id');

        if (!tickets[id]) {
            return interaction.editReply("Order not found.");
        }

        const pdfPath = await generatePDF(tickets[id]);

        const attachment = new AttachmentBuilder(pdfPath);

        try {
            await interaction.user.send({
                content: "📄 Here is your designer document:",
                files: [attachment]
            });

            await interaction.editReply("Document sent to your DMs.");
        } catch {
            await interaction.editReply("I couldn't DM you.");
        }

        fs.unlinkSync(pdfPath);
    }
});

client.login(process.env.TOKEN);
